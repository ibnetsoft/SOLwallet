import { apiFetch } from './client';

export interface WithdrawParams {
  walletId: string;
  toAddress: string;
  mint: string;
  amount: number;
  signedTx: string;
}

/**
 * 출금 — 서명된 트랜잭션 제출
 */
export async function submitWithdraw(params: WithdrawParams): Promise<{ txSignature: string }> {
  return apiFetch('/withdraw', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
