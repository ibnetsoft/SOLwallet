import { create } from 'zustand';
import * as ordersApi from '@/lib/api/orders';
import * as balanceApi from '@/lib/api/balance';
import * as tokensApi from '@/lib/api/tokens';
import * as manifestClient from '@/lib/manifest/client';
import { getFeeRate } from '@/lib/api/settings';
import { FEE_RATE, QUICK_AMOUNT_RATIOS, USDC_MINT, USDT_MINT } from '@solwallet/config';
import { useWalletStore } from './useWalletStore';
import type { Token } from '@/lib/api/tokens';
import { getMsg } from '@/lib/i18n';

interface OrderInfo {
  id: string;
  tokenId: string;
  tokenSymbol: string;
  side: string;
  price: string;
  quantity: string;
  fee: string;
  status: string;
  created_at: string;
}

interface OrderbookEntry {
  price: number;
  quantity: number;
}

interface TradeState {
  // Trade form
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  selectedToken: Token | null;
  price: string;
  quantity: string;

  // Market data
  orderbook: { bids: OrderbookEntry[]; asks: OrderbookEntry[] };
  currentPrice: number;
  tokens: Token[];
  feeRate: number;

  // Orders
  activeOrders: OrderInfo[];
  orderHistory: OrderInfo[];
  historyHasMore: boolean;
  historyCursor: string | null;
  isLoadingMoreHistory: boolean;

  // UI state
  isSubmitting: boolean;
  isOrderbookLoading: boolean;

  // Actions
  setSide: (side: 'buy' | 'sell') => void;
  setOrderType: (orderType: 'limit' | 'market') => void;
  setSelectedToken: (token: Token | null) => void;
  setPrice: (price: string) => void;
  setQuantity: (quantity: string) => void;
  applyQuickRatio: (ratio: number, maxQuantity: number) => void;
  applyCurrentPrice: () => void;

  // Data fetching
  fetchTokens: () => Promise<void>;
  fetchFeeRate: () => Promise<void>;
  fetchOrderbook: () => Promise<void>;
  fetchCurrentPrice: () => Promise<void>;
  fetchActiveOrders: () => Promise<void>;
  fetchOrderHistory: () => Promise<void>;
  fetchMoreHistory: () => Promise<void>;

  // Order actions
  // pin은 지갑이 잠겨있을 때만 필요 — 이미 잠금 해제된 세션이면 생략 가능
  createAndSubmitOrder: (pin?: string) => Promise<{ txSignature?: string }>;
  /** 취소 성공 시 withdrawnTx가 있으면 묶여있던 자금이 지갑으로 반환된 것 */
  cancelOrder: (orderId: string, pin?: string) => Promise<{ txSignature?: string; withdrawnTx?: string }>;
  withdrawFunds: (pin: string) => Promise<{ txSignature?: string }>;
  /** @returns 인출 tx 서명 (인출할 잔액이 없거나 실패하면 null) */
  autoWithdrawIfPossible: () => Promise<string | null>;
}

export const useTradeStore = create<TradeState>((set, get) => ({
  side: 'buy',
  orderType: 'limit',
  selectedToken: null,
  price: '',
  quantity: '',
  orderbook: { bids: [], asks: [] },
  currentPrice: 0,
  tokens: [],
  feeRate: FEE_RATE,
  activeOrders: [],
  orderHistory: [],
  historyHasMore: false,
  historyCursor: null,
  isLoadingMoreHistory: false,
  isSubmitting: false,
  isOrderbookLoading: false,

  setSide: (side) => set({ side }),
  setOrderType: (orderType) => {
    // 시장가 전환 시 자동으로 현재가 적용
    if (orderType === 'market') {
      const { currentPrice } = get();
      set({ orderType, price: currentPrice > 0 ? String(currentPrice) : '' });
    } else {
      set({ orderType });
    }
  },
  setSelectedToken: (token) => set({ selectedToken: token, price: '', quantity: '' }),
  setPrice: (price) => set({ price }),
  setQuantity: (quantity) => set({ quantity }),

  applyQuickRatio: (ratio, maxQuantity) => {
    const qty = maxQuantity > 0 ? Math.floor(maxQuantity * ratio * 1e6) / 1e6 : 0;
    set({ quantity: qty > 0 ? String(qty) : '' });
  },

  applyCurrentPrice: () => {
    const { currentPrice } = get();
    if (currentPrice > 0) {
      set({ price: String(currentPrice) });
    }
  },

  fetchTokens: async () => {
    try {
      const tokens = await tokensApi.getTokens();
      set({ tokens });
      // 기본 토큰 선택 (USDT/USDC 제외 — 스테이블코인)
      const nonStable = tokens.find(
        (t) => t.symbol !== 'USDT' && t.symbol !== 'USDC',
      );
      if (!get().selectedToken && nonStable) {
        set({ selectedToken: nonStable });
      }
    } catch {
      // 무시
    }
  },

  fetchFeeRate: async () => {
    try {
      const rate = await getFeeRate();
      set({ feeRate: rate });
    } catch {
      // 무시 — 기본값 유지
    }
  },

  fetchOrderbook: async () => {
    const { selectedToken } = get();
    if (!selectedToken) return;

    set({ isOrderbookLoading: true });
    try {
      const quoteMint = selectedToken.symbol === 'SOL' ? USDC_MINT : USDT_MINT;
      const orderbook = await manifestClient.fetchOrderbook(selectedToken.mint_address, quoteMint);
      set({ orderbook });
    } catch {
      set({ orderbook: { bids: [], asks: [] } });
    } finally {
      set({ isOrderbookLoading: false });
    }
  },

  fetchCurrentPrice: async () => {
    const { selectedToken } = get();
    if (!selectedToken) return;

    try {
      const quoteMint = selectedToken.symbol === 'SOL' ? USDC_MINT : USDT_MINT;
      const price = await manifestClient.fetchCurrentPrice(selectedToken.mint_address, quoteMint);
      set({ currentPrice: price });
      // 시장가 모드일 때 가격 자동 동기화
      const { orderType } = get();
      if (orderType === 'market' && price > 0) {
        set({ price: String(price) });
      }
    } catch {
      // 무시
    }
  },

  fetchActiveOrders: async () => {
    try {
      const orders = await ordersApi.getActiveOrders();
      set({ activeOrders: (orders || []).map(normalizeOrder) });
    } catch {
      // 무시
    }
  },

  fetchOrderHistory: async () => {
    try {
      const page = await ordersApi.getOrderHistory();
      const orders = (page.items || []).map(normalizeOrder);

      // 체결(filled)된 주문이 새로 감지되면 자동 withdraw
      const prevFilled = get().orderHistory.filter((o) => o.status === 'filled').map((o) => o.id);
      const newFilled = orders.filter((o) => o.status === 'filled' && !prevFilled.includes(o.id));
      if (newFilled.length > 0) {
        console.log('[autoWithdraw] detected', newFilled.length, 'new filled orders — triggering withdraw');
        get().autoWithdrawIfPossible();
      }

      set({
        orderHistory: orders,
        historyHasMore: page.hasMore,
        historyCursor: page.nextCursor,
      });
    } catch {
      // 무시
    }
  },

  fetchMoreHistory: async () => {
    const { historyCursor, historyHasMore, isLoadingMoreHistory } = get();
    if (!historyHasMore || !historyCursor || isLoadingMoreHistory) return;

    set({ isLoadingMoreHistory: true });
    try {
      const page = await ordersApi.getOrderHistory(historyCursor);
      const more = (page.items || []).map(normalizeOrder);
      set((state) => ({
        orderHistory: [...state.orderHistory, ...more],
        historyHasMore: page.hasMore,
        historyCursor: page.nextCursor,
        isLoadingMoreHistory: false,
      }));
    } catch {
      set({ isLoadingMoreHistory: false });
    }
  },

  createAndSubmitOrder: async (pin) => {
    const { selectedToken, side, price, quantity } = get();
    if (!selectedToken || !price || !quantity) {
      throw new Error(getMsg('error.fillAllFields'));
    }

    const wallets = useWalletStore.getState().wallets;
    const activeWallet = wallets.find((w) => w.isActive) || wallets[0];
    if (!activeWallet) {
      throw new Error(getMsg('error.noActiveWallet'));
    }

    // 이미 잠금 해제된 세션이면 PIN 없이 재사용, 아니면 PIN으로 잠금 해제
    let secretKey = activeWallet.secretKey;
    if (!secretKey) {
      if (!pin) {
        throw new Error(getMsg('error.walletLocked'));
      }
      await useWalletStore.getState().unlockWallet(activeWallet.id, pin);
      secretKey = useWalletStore.getState().wallets.find((w) => w.id === activeWallet.id)?.secretKey;
    } else {
      useWalletStore.getState().extendSession();
    }
    if (!secretKey) {
      throw new Error(getMsg('error.walletUnlockFailed'));
    }

    set({ isSubmitting: true });

    try {
      // 1. 주문 생성 → unsigned tx (서버 DTO는 number 타입 요구)
      const result = await ordersApi.createOrder({
        tokenId: selectedToken.id,
        walletId: activeWallet.id,
        side,
        price: Number(price),
        quantity: Number(quantity),
        orderType: get().orderType,
      });

      if (!result.unsignedTx) {
        throw new Error(getMsg('error.txBuildFailed'));
      }

      // 2. ATA setup tx가 있으면 먼저 서명/제출 (첫 거래 전 토큰 계정 생성)
      const { signTransaction } = await import('@/lib/wallet');
      if (result.setupTx) {
        console.log('[trade] step 2: signing + submitting setupTx (ATA creation)');
        try {
          const signedSetupTx = signTransaction(result.setupTx, secretKey, 'legacy');
          await ordersApi.submitSetupTx(signedSetupTx);
          console.log('[trade] step 2: setupTx submitted');
        } catch (setupErr) {
          console.error('[trade] step 2 FAILED: setupTx:', setupErr);
          throw new Error('지갑 초기 설정(토큰 계정 생성)에 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
      }

      // 3. SOL 매도 시 fresh wSOL 래핑 tx 획득 + 서명/제출
      // createOrder에서 미리 만들지 않고 서명 직전 fresh하게 생성하여 blockhash 만료 방지
      if (side === 'sell' && selectedToken.symbol === 'SOL') {
        console.log('[trade] step 3: SOL sell → fetching fresh wrapTx');
        try {
          const { wrapTx } = await ordersApi.getWrapTx(result.order.id as string);
          if (wrapTx) {
            console.log('[trade] step 3: got wrapTx, signing...');
            const signedWrapTx = signTransaction(wrapTx, secretKey, 'legacy');
            console.log('[trade] step 3: submitting wrapTx...');
            await ordersApi.submitWrapTx(signedWrapTx);
            console.log('[trade] step 3: wrapTx submitted + confirmed');
          } else {
            console.log('[trade] step 3: wrapTx skipped — sufficient wSOL balance');
          }
        } catch (wrapErr) {
          console.error('[trade] step 3 FAILED: wrapTx:', wrapErr);
          // 서버가 구체적인 실패 사유(컨펌 지연/체인 미반영/RPC 오류 등)를 알려주면
          // 그대로 노출 — 매번 같은 문구만 뜨면 원인 파악이 불가능해짐
          const msg = wrapErr instanceof Error && wrapErr.message
            ? wrapErr.message
            : 'SOL을 wSOL으로 래핑하는 데 실패했습니다. 잠시 후 다시 시도해주세요.';
          throw new Error(msg);
        }
      }

      // 4. 서명 직전 fresh tx 획득 — Manifest blockhash 만료 방지
      console.log('[trade] step 4: fetching fresh order tx');
      const freshResult = await ordersApi.getFreshTx(result.order.id as string);

      // 4. 온디바이스 서명 (Manifest = versioned)
      console.log('[trade] step 5: signing order tx');
      const signedTx = signTransaction(freshResult.unsignedTx, secretKey, 'versioned');

      // 5. 서명된 트랜잭션 제출
      console.log('[trade] step 6: submitting order tx');
      const submitResult = await ordersApi.submitOrder(result.order.id as string, signedTx);
      console.log('[trade] step 6: order submitted —', submitResult.txSignature?.slice(0, 12));

      // 6. 활성 주문 새로고침 — 즉시 + 10초/20초 뒤 폴링 (체결 반영)
      get().fetchActiveOrders();
      setTimeout(() => get().fetchActiveOrders(), 10_000);
      setTimeout(() => get().fetchActiveOrders(), 20_000);

      // 세션 유지 — 다음 거래/취소는 PIN 재입력 없이 진행 (특수 케이스만 별도 확인)
      return submitResult;
    } finally {
      set({ isSubmitting: false });
    }
  },

  cancelOrder: async (orderId, pin) => {
    const wallets = useWalletStore.getState().wallets;
    const activeWallet = wallets.find((w) => w.isActive) || wallets[0];
    if (!activeWallet) {
      throw new Error(getMsg('error.noActiveWallet'));
    }

    // 이미 잠금 해제된 세션이면 PIN 없이 재사용, 아니면 PIN으로 잠금 해제
    let secretKey = activeWallet.secretKey;
    if (!secretKey) {
      if (!pin) {
        throw new Error(getMsg('error.walletLocked'));
      }
      await useWalletStore.getState().unlockWallet(activeWallet.id, pin);
      secretKey = useWalletStore.getState().wallets.find((w) => w.id === activeWallet.id)?.secretKey;
    } else {
      useWalletStore.getState().extendSession();
    }
    if (!secretKey) {
      throw new Error(getMsg('error.walletUnlockFailed'));
    }

    // 1. Manifest에서 fresh cancel tx 획득 (취소 요청 + fresh blockhash 한 번에 처리)
    const freshCancel = await ordersApi.getFreshCancelTx(orderId);

    // 주문이 온체인에 없어 DB에서 삭제된 경우 → 성공으로 처리
    if (freshCancel.cancelled || !freshCancel.unsignedTx) {
      console.log('[cancelOrder] order was not on-chain, already removed from DB');
      get().fetchActiveOrders();
      return { txSignature: '' };
    }

    // 2. 온디바이스 서명 (Manifest 취소 = versioned)
    const { signTransaction } = await import('@/lib/wallet');
    const signedTx = signTransaction(freshCancel.unsignedTx, secretKey, 'versioned');

    // 3. 서명된 cancel tx 제출
    const result = await ordersApi.submitCancelOrder(orderId, signedTx);

    // 4. 취소된 주문에 묶여있던 자금을 지갑으로 자동 인출.
    //    Manifest는 주문을 취소해도 자금을 마켓 계정에 "인출 가능 잔액"으로 남겨두고
    //    지갑으로 돌려주지 않는다. 이걸 안 하면 사용자는 "취소했는데 코인이 안 돌아왔다"고
    //    느끼고, 실제로 자금이 방치된다.
    const withdrawnTx = await get().autoWithdrawIfPossible();

    // 5. 활성 주문 새로고침
    get().fetchActiveOrders();

    // 세션 유지 — 다음 거래/취소는 PIN 재입력 없이 진행
    return { ...result, withdrawnTx: withdrawnTx || undefined };
  },

  withdrawFunds: async (pin) => {
    const wallets = useWalletStore.getState().wallets;
    const activeWallet = wallets.find((w) => w.isActive) || wallets[0];
    if (!activeWallet) {
      throw new Error(getMsg('error.noActiveWallet'));
    }

    // 출금은 특수 케이스 — 이미 잠금 해제된 세션이어도 매번 PIN으로 재확인
    await useWalletStore.getState().unlockWallet(activeWallet.id, pin);

    const secretKey = useWalletStore.getState().wallets.find((w) => w.id === activeWallet.id)?.secretKey;
    if (!secretKey) {
      throw new Error(getMsg('error.walletUnlockFailed'));
    }

    const { signTransaction } = await import('@/lib/wallet');

    // 1. Manifest에서 withdraw tx 획득 (Global 잔액 인출)
    console.log('[withdrawFunds] fetching withdraw tx...');
    const { unsignedTx } = await ordersApi.getWithdrawTx(activeWallet.id);

    // 2. 온디바이스 서명 (withdraw = legacy)
    console.log('[withdrawFunds] signing withdraw tx...');
    const signedTx = signTransaction(unsignedTx, secretKey, 'legacy');

    // 3. 서명된 withdraw tx 제출
    console.log('[withdrawFunds] submitting...');
    const result = await ordersApi.submitWithdrawTx(signedTx);
    console.log('[withdrawFunds] done —', result.txSignature?.slice(0, 12));

    // 4. 잔액 새로고침
    get().fetchActiveOrders();

    // 세션 유지 — 거래/취소는 계속 PIN 없이 가능
    return result;
  },

  /**
   * 체결/취소 후 자동 withdraw — 지갑이 unlock 상태면 PIN 없이 실행
   * @returns 인출 성공 시 tx 서명, 인출할 잔액이 없거나 실패하면 null
   */
  autoWithdrawIfPossible: async () => {
    const wallets = useWalletStore.getState().wallets;
    const activeWallet = wallets.find((w) => w.isActive) || wallets[0];
    if (!activeWallet) return null;

    const secretKey = useWalletStore.getState().wallets.find((w) => w.id === activeWallet.id)?.secretKey;
    if (!secretKey) {
      console.log('[autoWithdraw] wallet locked — skip (user must withdraw manually)');
      return null;
    }

    try {
      console.log('[autoWithdraw] wallet unlocked — executing auto withdraw...');
      const { signTransaction } = await import('@/lib/wallet');

      const { unsignedTx } = await ordersApi.getWithdrawTx(activeWallet.id);
      const signedTx = signTransaction(unsignedTx, secretKey, 'legacy');
      const result = await ordersApi.submitWithdrawTx(signedTx);
      console.log('[autoWithdraw] done —', result.txSignature?.slice(0, 12));

      // 잔액 새로고침
      get().fetchActiveOrders();
      get().fetchOrderHistory();
      return result.txSignature || null;
    } catch (err) {
      // "인출할 잔액이 없습니다"는 정상 흐름(이미 인출됐거나 잠긴 자금이 없음)
      console.warn('[autoWithdraw] skipped/failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  },
}));

// ─── Helper ───

function normalizeOrder(o: Record<string, unknown>): OrderInfo {
  return {
    id: o.id as string,
    tokenId: o.token_id as string,
    tokenSymbol: o.token_symbol as string || '—',
    side: o.side as string,
    price: o.price as string,
    quantity: o.quantity as string,
    fee: o.fee as string,
    status: o.status as string,
    created_at: o.created_at as string,
  };
}