import { create } from 'zustand';
import * as ordersApi from '@/lib/api/orders';
import * as balanceApi from '@/lib/api/balance';
import * as tokensApi from '@/lib/api/tokens';
import * as manifestClient from '@/lib/manifest/client';
import { FEE_RATE, QUICK_AMOUNT_RATIOS } from '@solwallet/config';
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

  // Orders
  activeOrders: OrderInfo[];
  orderHistory: OrderInfo[];

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
  fetchOrderbook: () => Promise<void>;
  fetchCurrentPrice: () => Promise<void>;
  fetchActiveOrders: () => Promise<void>;
  fetchOrderHistory: () => Promise<void>;

  // Order actions
  createAndSubmitOrder: (pin: string) => Promise<{ txSignature?: string }>;
  cancelOrder: (orderId: string) => Promise<void>;
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
  activeOrders: [],
  orderHistory: [],
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
      // 기본 토큰 선택 (USDT 제외)
      const nonUsdt = tokens.find((t) => t.symbol !== 'USDT');
      if (!get().selectedToken && nonUsdt) {
        set({ selectedToken: nonUsdt });
      }
    } catch {
      // 무시
    }
  },

  fetchOrderbook: async () => {
    const { selectedToken } = get();
    if (!selectedToken) return;

    set({ isOrderbookLoading: true });
    try {
      const orderbook = await manifestClient.fetchOrderbook(selectedToken.mint_address);
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
      const price = await manifestClient.fetchCurrentPrice(selectedToken.mint_address);
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
      const orders = await ordersApi.getOrderHistory();
      set({ orderHistory: (orders || []).map(normalizeOrder) });
    } catch {
      // 무시
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

    // 지갑 잠금 해제
    await useWalletStore.getState().unlockWallet(activeWallet.id, pin);

    const secretKey = useWalletStore.getState().wallets.find((w) => w.id === activeWallet.id)?.secretKey;
    if (!secretKey) {
      useWalletStore.getState().lockWallets();
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
      });

      if (!result.unsignedTx) {
        useWalletStore.getState().lockWallets();
        throw new Error(getMsg('error.txBuildFailed'));
      }

      // 2. 온디바이스 서명
      const { signTransaction } = await import('@/lib/wallet');
      const signedTx = signTransaction(result.unsignedTx, secretKey);

      // 3. 서명된 트랜잭션 제출
      const submitResult = await ordersApi.submitOrder(result.order.id as string, signedTx);

      // 4. 활성 주문 새로고침
      get().fetchActiveOrders();

      // 5. 메모리에서 키 해제
      useWalletStore.getState().lockWallets();

      return submitResult;
    } catch (err) {
      useWalletStore.getState().lockWallets();
      throw err;
    } finally {
      set({ isSubmitting: false });
    }
  },

  cancelOrder: async (orderId) => {
    await ordersApi.cancelOrder(orderId);
    await get().fetchActiveOrders();
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