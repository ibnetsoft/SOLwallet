import { API_BASE } from './client';

/**
 * Admin 로그인 — secret 검증 → JWT 발급 → localStorage 저장
 */
export async function adminLogin(secret: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
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
    window.location.href = '/login';
  }
}

/**
 * Admin 토큰 확인
 */
export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_auth_token');
}
