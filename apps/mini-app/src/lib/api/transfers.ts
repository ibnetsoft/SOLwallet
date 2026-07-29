import { apiFetch } from './client';

export interface TransferItem {
  id: string; // transaction signature
  type: 'deposit' | 'withdraw';
  amount: number;
  tokenSymbol: string;
  status: string;
  createdAt: string; // ISO date string
}

/**
 * 입출금 내역 조회 — 서버를 경유해 Solana RPC 호출
 */
export async function getTransferHistory(
  walletAddress: string,
  limit = 20,
): Promise<TransferItem[]> {
  try {
    const data = await apiFetch(
      `/transfers?walletAddress=${encodeURIComponent(walletAddress)}&limit=${limit}`,
    );
    return (data as TransferItem[]) ?? [];
  } catch (error) {
    console.error('Failed to fetch transfer history:', error);
    return [];
  }
}
