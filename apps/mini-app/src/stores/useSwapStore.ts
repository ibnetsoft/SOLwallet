import { create } from 'zustand';
import * as swapApi from '@/lib/api/swap';
import { useWalletStore } from './useWalletStore';
import { getMsg } from '@/lib/i18n';
import { USDT_MINT, USDC_MINT } from '@solwallet/config';

// ─── Types ───

export interface SwapToken {
  mint: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
}

interface SwapState {
  inputToken: SwapToken;
  outputToken: SwapToken;
  /** human-readable 입력 수량 (토큰 단위) */
  inputAmount: string;
  slippageBps: number;
  quote: swapApi.SwapQuoteResult | null;
  isQuoting: boolean;
  isExecuting: boolean;

  setInputAmount: (amount: string) => void;
  swapDirection: () => void;
  setSlippageBps: (bps: number) => void;
  fetchQuote: (walletId: string) => Promise<void>;
  clearQuote: () => void;
  // pin은 지갑이 잠겨있을 때만 필요 — 이미 잠금 해제된 세션이면 생략 가능
  executeSwap: (pin?: string) => Promise<{ txSignature: string }>;
}

// USDC / USDC 기본 토큰 정의 (환경설정 없이 사용 가능)
const USDT: SwapToken = {
  mint: USDT_MINT,
  symbol: 'USDT',
  decimals: 6,
};
const USDC: SwapToken = {
  mint: USDC_MINT,
  symbol: 'USDC',
  decimals: 6,
};

/** human-readable 수량 → atomic units 문자열 */
function toAtomicAmount(amount: string, decimals: number): string {
  const n = Number(amount);
  if (!isFinite(n) || n <= 0) return '0';
  // 부동소수 오류 방지를 위해 문자열 곱셈 기반으로 변환
  const [intPart, fracPart = ''] = amount.split('.');
  const fracPadded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  // 선행 0 제거
  const combined = `${intPart}${fracPadded}`.replace(/^0+/, '') || '0';
  return combined;
}

export const useSwapStore = create<SwapState>((set, get) => ({
  inputToken: USDT,
  outputToken: USDC,
  inputAmount: '',
  slippageBps: 50, // 0.5%
  quote: null,
  isQuoting: false,
  isExecuting: false,

  setInputAmount: (amount) => {
    set({ inputAmount: amount, quote: null });
  },

  swapDirection: () => {
    const { inputToken, outputToken, inputAmount } = get();
    set({
      inputToken: outputToken,
      outputToken: inputToken,
      inputAmount: '',
      quote: null,
    });
    void inputAmount; // 입력값은 방향 전환 시 초기화
  },

  setSlippageBps: (bps) => set({ slippageBps: bps, quote: null }),

  clearQuote: () => set({ quote: null }),

  fetchQuote: async (walletId) => {
    const { inputToken, outputToken, inputAmount, slippageBps } = get();
    if (!inputAmount || Number(inputAmount) <= 0) {
      set({ quote: null });
      return;
    }

    set({ isQuoting: true });
    try {
      const result = await swapApi.getSwapQuote({
        walletId,
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: toAtomicAmount(inputAmount, inputToken.decimals),
        slippageBps,
      });
      // 입력이 변경되지 않았을 때만 저장
      if (get().inputAmount === inputAmount) {
        set({ quote: result });
      }
    } catch {
      set({ quote: null });
    } finally {
      set({ isQuoting: false });
    }
  },

  executeSwap: async (pin) => {
    const { inputToken, outputToken, inputAmount, slippageBps } = get();
    if (!inputAmount || Number(inputAmount) <= 0) {
      throw new Error(getMsg('swap.enterAmount'));
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
      secretKey = useWalletStore
        .getState()
        .wallets.find((w) => w.id === activeWallet.id)?.secretKey;
    } else {
      useWalletStore.getState().extendSession();
    }
    if (!secretKey) {
      throw new Error(getMsg('error.walletUnlockFailed'));
    }

    set({ isExecuting: true });

    try {
      // 1. 견적 + unsigned tx 조회 (이미 quote가 있으면 재사용 가능하지만,
      //    실행 시점에는 최신 견적을 강제로 다시 받아 신선도 보장)
      const result = await swapApi.getSwapQuote({
        walletId: activeWallet.id,
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: toAtomicAmount(inputAmount, inputToken.decimals),
        slippageBps,
      });

      if (!result.unsignedTx) {
        throw new Error(getMsg('error.txBuildFailed'));
      }

      // 2. 온디바이스 서명 (Jupiter swap = versioned)
      const { signTransaction } = await import('@/lib/wallet');
      const signedTx = signTransaction(result.unsignedTx, secretKey, 'versioned');

      // 3. 서명된 트랜잭션 제출
      const submitResult = await swapApi.executeSwap(signedTx);

      // 성공 시 입력 초기화 — 세션은 유지 (다음 스왑/거래도 PIN 불필요)
      set({ inputAmount: '', quote: null });

      return submitResult;
    } finally {
      set({ isExecuting: false });
    }
  },
}));

// USDT/USDC 기본 토큰 export (페이지 초기화용)
export const DEFAULT_SWAP_TOKENS = { USDT, USDC };
