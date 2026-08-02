import { apiFetch } from './client';

export interface WalletBalance {
  walletAddress: string;
  sol: number;
  tokens: Array<{ mint: string; symbol: string; decimals: number; balance: number; usdValue: number; logoUrl?: string }>;
  totalUsdtValue: number;
  /** ROI 초기값 — 이 지갑에 각 코인이 최초로 입금됐을 때의 달러 가치 합계 */
  roiBaseline: number;
  /** 외부로 실제로 나간 출금 누적액(USD) — ROI 계산에서 제외됨 */
  withdrawnTotal: number;
}

export interface Portfolio {
  wallets: Array<WalletBalance & { publicKey: string }>;
  totalUsdt: number;
  roiBaseline: number;
  withdrawnTotal: number;
}

/**
 * 특정 지갑 잔액
 */
export async function getWalletBalance(walletAddress: string): Promise<WalletBalance> {
  return apiFetch(`/balance/${walletAddress}`);
}

/**
 * 유저 포트폴리오
 */
export async function getPortfolio(): Promise<Portfolio> {
  return apiFetch('/balance');
}
