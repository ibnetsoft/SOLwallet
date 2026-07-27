import { apiFetch } from './client';

export interface SwapQuoteParams {
  walletId: string;
  inputMint: string;
  outputMint: string;
  /** atomic units (토큰 decimals 기준 정수 문자열) */
  amount: string;
  /** 슬리피지 (bps). 기본 50 = 0.5% */
  slippageBps?: number;
}

export interface SwapQuoteInfo {
  inAmount: string;
  outAmount: string;
  outAmountThreshold: string;
  priceImpactPct: number;
}

export interface SwapQuoteResult {
  unsignedTx: string;
  quoteInfo: SwapQuoteInfo;
}

/**
 * 스왑 견적 + unsigned 트랜잭션 조회 (1단계)
 * 백엔드가 Jupiter Quote/Swap API를 호출해 unsigned versioned tx를 반환합니다.
 */
export async function getSwapQuote(
  params: SwapQuoteParams,
): Promise<SwapQuoteResult> {
  return apiFetch('/swap/quote', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * 서명된 스왑 트랜잭션 제출 (2단계)
 */
export async function executeSwap(
  signedTx: string,
): Promise<{ txSignature: string }> {
  return apiFetch('/swap/execute', {
    method: 'POST',
    body: JSON.stringify({ signedTx }),
  });
}
