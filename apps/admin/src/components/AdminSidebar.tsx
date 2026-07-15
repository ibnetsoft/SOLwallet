'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: '📊 대시보드' },
  { href: '/users', label: '👥 회원 관리' },
  { href: '/tokens', label: '🪙 토큰 관리' },
  { href: '/transactions', label: '📋 트랜잭션' },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen">
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-lg font-bold">🔥 DEX MINER</h1>
        <p className="text-xs text-gray-400">Admin Dashboard</p>
      </div>
      <nav className="p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-4 py-3 rounded-lg text-sm transition ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
