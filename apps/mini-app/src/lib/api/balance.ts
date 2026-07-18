import { apiFetch } from './client';

export interface WalletBalance {
  walletAddress: string;
  sol: number;
  tokens: Array<{ mint: string; symbol: string; decimals: number; balance: number; logoUrl?: string }>;
  totalUsdtValue: number;
}

export interface Portfolio {
  wallets: Array<WalletBalance & { publicKey: string }>;
  totalUsdt: number;
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
