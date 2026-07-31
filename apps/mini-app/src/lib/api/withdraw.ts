import { apiFetch } from './client';

export interface WithdrawParams {
  walletId: string;
  toAddress: string;
  mint: string;
  amount: number;
  signedTx: string;
}

export interface AddressCheckResult {
  isNewAccount: boolean;
  minWithdraw: number;
}

/**
 * 수신 주소가 새 계정(0 lamports)인지 확인
 */
export async function checkWithdrawAddress(address: string): Promise<AddressCheckResult> {
  return apiFetch(`/withdraw/check-address?address=${encodeURIComponent(address)}`);
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
