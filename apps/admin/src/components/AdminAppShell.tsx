'use client';

import AdminSidebar from './AdminSidebar';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_auth_token');
}

/**
 * JWT의 `exp` 클레임을 디코딩해서 만료 여부를 판별한다.
 * - 서명 검증은 서버에서 수행하므로 클라이언트는 exp만 확인한다.
 * - 토큰 포맷이 잘못된 경우 만료된 것으로 취급.
 */
function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    // JWT payload는 base64url. atob()를 위해 패딩을 맞춘다.
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '==='.slice((base64.length + 3) % 4);
    const payload = JSON.parse(
      typeof window !== 'undefined'
        ? window.atob(padded)
        : Buffer.from(base64, 'base64').toString('utf-8'),
    ) as { exp?: number };
    if (typeof payload.exp !== 'number') return false; // exp 없음 → 서버가 판단
    // exp는 초 단위. 30초 여유를 둔다.
    return Date.now() >= payload.exp * 1000 - 30_000;
  } catch {
    return true;
  }
}

/**
 * 만료/무효 토큰 정리 후 로그인으로 이동
 */
function clearAndRedirect(replace = true) {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('admin_auth_token');
  if (replace) {
    window.location.replace('/login');
  } else {
    window.location.href = '/login';
  }
}

/**
 * 클라이언트 래퍼 — 로그인 상태에 따라 사이드바 표시/숨김
 *
 * 인증은 localStorage의 `admin_auth_token`로 처리하므로
 * Next.js middleware(server-side)에서는 판별할 수 없다.
 * 대신 이 컴포넌트에서 JWT exp를 디코딩해 만료를 검사하고,
 * 만료 시 토큰을 삭제한 뒤 /login으로 리다이렉트한다.
 */
export default function AdminAppShell({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === '/login';

  useEffect(() => {
    const token = getAdminToken();
    if (token && !isTokenExpired(token)) {
      setIsAuthenticated(true);
    } else {
      // 만료됐거나 없으면 정리
      if (token) {
        localStorage.removeItem('admin_auth_token');
      }
      setIsAuthenticated(false);
    }
    setIsLoading(false);
  }, []);

  // 로그인 페이지가 아니고 인증도 안 됨 → login으로 이동
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isLoginPage) {
      // window.location.replace 로 뒤로가기 이슈 방지
      clearAndRedirect(true);
    }
  }, [isLoading, isAuthenticated, isLoginPage]);

  // 인증됨 + 로그인 페이지에 있음 → 대시보드로 이동 (부드러운 전환)
  useEffect(() => {
    if (!isLoading && isAuthenticated && isLoginPage) {
      router.replace('/');
    }
  }, [isLoading, isAuthenticated, isLoginPage, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <p className="text-gray-400">로딩...</p>
      </div>
    );
  }

  // 로그인 페이지는 전체화면 (사이드바 없음)
  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      {isAuthenticated && <AdminSidebar />}
      <main className="flex-1 p-6">
        {children}
      </main>
    </div>
  );
}
