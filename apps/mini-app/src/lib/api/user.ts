import { apiFetch } from './client';

export interface UserProfile {
  id: string;
  telegram_uid: string;
  username: string;
  first_name: string;
  last_name: string;
  referred_by: string | null;
  referrer: { username: string; first_name: string } | null;
  referralCount: number;       // 1대 추천 수 (직접 추천)
  totalReferralCount: number;  // 총 추천 수 (하위 전체)
  referralCode: string;
  created_at: string;
}

/**
 * 내 프로필 + 추천인 정보 조회
 */
export async function getUserProfile(): Promise<UserProfile> {
  return apiFetch('/user/profile');
}
