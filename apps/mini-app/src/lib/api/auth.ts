import { API_BASE } from './client';
import { saveAuthToken, clearAuthToken, clearAllStorage } from '@/lib/storage';
import { getMsg } from '@/lib/i18n';

/**
 * Telegram initData로 로그인 (프로덕션)
 * @param initData Telegram WebApp initData (서명된 문자열)
 * @param referralCode 추천인 코드 (선택) — 신규 가입 시에만 적용
 * @returns { token, referralApplied } — referralApplied는 추천인 코드가 유효해서 연결되었는지 여부
 */
export async function telegramLogin(initData: string, referralCode?: string): Promise<{ token: string; referralApplied?: boolean }> {
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
  return { token: json.data.token, referralApplied: json.data.referralApplied };
}

/**
 * 개발용 로그인 — Telegram 없이 테스트 유저로 로그인
 * DEV_LOGIN_SECRET이 서버에 설정된 경우 x-dev-secret 헤더로 전달
 * telegramUid를 지정하면 특정 계정(예: mayersam)으로 로그인 가능
 */
export async function devLogin(username?: string, devSecret?: string, telegramUid?: number): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/dev`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(devSecret ? { 'x-dev-secret': devSecret } : {}),
    },
    body: JSON.stringify({ username, telegramUid }),
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

/**
 * 로그아웃 — 인증 토큰만 삭제 (지갑 데이터는 유지)
 * 같은 기기에서 다른 계정으로 전환하거나 재로그인할 때 사용.
 * Telegram 미니앱 환경에서는 다시 열면 현재 Telegram 계정으로 자동 로그인됨.
 */
/**
 * 로그아웃 후 자동 재로그인을 막기 위한 플래그.
 * Telegram 미니앱은 로그인 페이지에 들어가면 initData로 즉시 자동 로그인되기 때문에,
 * 이 플래그가 없으면 로그아웃을 눌러도 곧바로 다시 로그인되어 아무 일도 없는 것처럼 보인다.
 * sessionStorage라 앱을 완전히 닫았다 열면 자연스럽게 해제된다.
 */
const LOGGED_OUT_FLAG = 'solwallet_logged_out';

export function logout(): void {
  clearAuthToken();
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(LOGGED_OUT_FLAG, '1');
  }
}

/** 사용자가 방금 로그아웃했는지 — 로그인 페이지의 자동 로그인 차단용 */
export function isLoggedOutByUser(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(LOGGED_OUT_FLAG) === '1';
}

/** 수동 로그인 시 호출 — 자동 로그인 차단 해제 */
export function clearLoggedOutFlag(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(LOGGED_OUT_FLAG);
  }
}

/**
 * 완전 로그아웃 — 인증 토큰 + 로컬 지갑 데이터(암호화된 개인키 포함) 모두 삭제
 * ⚠️ 이 기기의 지갑 개인키가 영구 삭제됨.
 *    시드 구문 백업이 없으면 복구 불가.
 * 기기 변경, 계정 완전 초기화 시 사용.
 */
export function fullLogout(): void {
  clearAllStorage();
}