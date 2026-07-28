'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { adminLogout } from '@/lib/api/auth';

const navItems = [
  { href: '/', icon: '📊', label: '대시보드' },
  { href: '/users', icon: '👥', label: '회원 관리' },
  { href: '/tokens', icon: '🪙', label: '토큰 관리' },
  { href: '/transactions', icon: '📋', label: '트랜잭션' },
  { href: '/revenue', icon: '💰', label: '수수료 정산' },
  { href: '/referral-tree', icon: '🌳', label: '추천 조직도' },
  { href: '/settings', icon: '⚙️', label: '설정' },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside className={`${isCollapsed ? 'w-20' : 'w-64'} bg-gray-900 min-h-screen flex flex-col transition-all duration-300`}>
      <div className={`p-6 border-b border-gray-800 flex items-center ${isCollapsed ? 'justify-center px-2' : 'justify-between'}`}>
        {!isCollapsed && (
          <div>
            <h1 className="text-lg font-bold">AOI Wallet</h1>
            <p className="text-xs text-gray-400">Admin Dashboard</p>
          </div>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-gray-400 hover:text-white transition focus:outline-none"
          title={isCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
        >
          {isCollapsed ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          )}
        </button>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-start gap-3'} px-4 py-3 rounded-lg text-sm transition ${
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
              title={isCollapsed ? item.label : undefined}
            >
              <span className="text-lg">{item.icon}</span>
              {!isCollapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
      {/* Logout */}
      <div className="p-4 border-t border-gray-800">
        <button
          onClick={adminLogout}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center px-0' : 'justify-center gap-2 px-4'} py-3 rounded-lg text-sm text-gray-400 hover:bg-danger/10 hover:text-danger transition`}
          title={isCollapsed ? '로그아웃' : undefined}
        >
          <span className="text-lg">🚪</span>
          {!isCollapsed && <span>로그아웃</span>}
        </button>
      </div>
    </aside>
  );
}
