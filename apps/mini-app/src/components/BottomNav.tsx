'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home as HomeIcon, BarChart3, Settings } from 'lucide-react';

/**
 * 하단 네비게이션 — 모든 페이지에서 공통 사용
 * 현재 pathname에 따라 활성 탭 자동 감지
 */
export function BottomNav() {
  const pathname = usePathname();

  // 활성 탭 감지 — 정확히 일치하거나 하위 경로
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const items = [
    { href: '/', label: '홈', Icon: HomeIcon },
    { href: '/trade', label: '거래', Icon: BarChart3 },
    { href: '/settings', label: '설정', Icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800">
      <div className="flex justify-around py-2">
        {items.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 py-1 ${
                active ? 'text-primary-500' : 'text-gray-500'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={2} />
              <span className="text-[10px]">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
