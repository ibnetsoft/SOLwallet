import { API_BASE } from './client';

/**
 * Admin 로그인 — username/password 검증 → JWT 발급 → localStorage 저장
 * username 없이 secret만 오면 이전 호환 방식으로 처리
 */
export async function adminLogin(usernameOrSecret: string, password?: string): Promise<void> {
  const body = password
    ? { username: usernameOrSecret, password }
    : { secret: usernameOrSecret };

  const res = await fetch(`${API_BASE}/auth/admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: '로그인 실패' }));
    throw new Error(error.message || '관리자 인증에 실패했습니다.');
  }

  const json = await res.json();

  if (!json.success || !json.data?.token) {
    throw new Error('유효하지 않은 응답입니다.');
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem('admin_auth_token', json.data.token);
  }
}

/**
 * Admin 토큰 삭제 (로그아웃)
 */
export function adminLogout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('admin_auth_token');
    window.location.href = '/admin/login';
  }
}

/**
 * Admin 토큰 확인
 */
export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_auth_token');
}

/**
 * JWT payload에서 role을 읽어온다 (클라이언트 전용, 서명 검증 없음)
 * 반환: 'superadmin' | 'subadmin' | 'admin' | null
 */
export function getAdminRole(): string | null {
  const token = getAdminToken();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '==='.slice((base64.length + 3) % 4);
    const payload = JSON.parse(window.atob(padded)) as { role?: string };
    return payload.role || null;
  } catch {
    return null;
  }
}
