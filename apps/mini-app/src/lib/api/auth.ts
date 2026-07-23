import { API_BASE } from './client';
import { saveAuthToken } from '@/lib/storage';
import { getMsg } from '@/lib/i18n';

/**
 * Telegram initData로 로그인 (프로덕션)
 * @param initData Telegram WebApp initData (서명된 문자열)
 * @param referralCode 추천인 코드 (선택) — 신규 가입 시에만 적용
 */
export async function telegramLogin(initData: string, referralCode?: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData, referralCode }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || getMsg('error.telegramAuth'));
  }

  const json = await res.json();
  if (!json.success || !json.data?.token) {
    throw new Error(getMsg('error.invalidResponse'));
  }

  saveAuthToken(json.data.token);
  return json.data.token;
}

/**
 * 개발용 로그인 — Telegram 없이 테스트 유저로 로그인
 * DEV_LOGIN_SECRET이 서버에 설정된 경우 x-dev-secret 헤더로 전달
 */
export async function devLogin(username?: string, devSecret?: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/dev`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(devSecret ? { 'x-dev-secret': devSecret } : {}),
    },
    body: JSON.stringify({ username }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || getMsg('error.devLoginFailed'));
  }

  const json = await res.json();
  if (!json.success || !json.data?.token) {
    throw new Error(getMsg('error.invalidResponse'));
  }

  saveAuthToken(json.data.token);
  return json.data.token;
}

/**
 * 현재 auth token 존재 여부
 */
export function isLoggedIn(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('solwallet_auth_token');
}