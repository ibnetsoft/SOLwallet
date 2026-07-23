import { apiFetch } from './client';
import { FEE_RATE } from '@solwallet/config';

/**
 * 거래 수수료율 조회 (공개 API — 인증 불필요)
 * 실패 시 config의 기본값(1%) 사용
 */
export async function getFeeRate(): Promise<number> {
  try {
    const data = await apiFetch<{ feeRate: number }>('/settings/fee-rate');
    return data.feeRate;
  } catch {
    return FEE_RATE;
  }
}
