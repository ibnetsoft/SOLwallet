'use client';

import AdminSidebar from './AdminSidebar';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_auth_token');
}

/**
 * 클라이언트 래퍼 — 로그인 상태에 따라 사이드바 표시/숨김
 */
export default function AdminAppShell({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';

  useEffect(() => {
    const token = getAdminToken();
    if (token) {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
    setIsLoading(false);
  }, []);

  // 로그인 페이지가 아니고 인증도 안 됨 → login으로 이동
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isLoginPage) {
      window.location.href = '/login';
    }
  }, [isLoading, isAuthenticated, isLoginPage]);

  // 인증됨 + 로그인 페이지에 있음 → 대시보드로 이동
  useEffect(() => {
    if (!isLoading && isAuthenticated && isLoginPage) {
      window.location.href = '/';
    }
  }, [isLoading, isAuthenticated, isLoginPage]);

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
