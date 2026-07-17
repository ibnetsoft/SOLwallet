import { API_BASE } from './client';
import { saveAuthToken } from '@/lib/storage';

/**
 * Telegram initData로 로그인 (프로덕션)
 */
export async function telegramLogin(initData: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || 'Telegram 인증 실패');
  }

  const json = await res.json();
  if (!json.success || !json.data?.token) {
    throw new Error('유효하지 않은 응답');
  }

  saveAuthToken(json.data.token);
  return json.data.token;
}

/**
 * 개발용 로그인 — Telegram 없이 테스트 유저로 로그인
 * ⚠️ 개발 모드 전용 (NODE_ENV !== production)
 */
export async function devLogin(username?: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/dev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || '개발 로그인 실패');
  }

  const json = await res.json();
  if (!json.success || !json.data?.token) {
    throw new Error('유효하지 않은 응답');
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
