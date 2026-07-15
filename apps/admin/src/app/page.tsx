'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getStats } from '@/lib/api/admin';
import type { AdminStats } from '@solwallet/shared-types';

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchStats() {
      try {
        const data = await getStats();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : '통계 조회 실패');
      } finally {
        setIsLoading(false);
      }
    }
    fetchStats();
  }, []);

  const statCards = [
    {
      label: '총 가입 유저',
      value: stats?.totalUsers ?? 0,
      icon: '👥',
      color: 'text-blue-400',
    },
    {
      label: '오늘 신규 가입',
      value: stats?.todaySignups ?? 0,
      icon: '📈',
      color: 'text-green-400',
    },
    {
      label: '수수료 수익 (USDT)',
      value: stats ? `$${stats.totalFeeRevenue.toFixed(2)}` : '$0.00',
      icon: '💰',
      color: 'text-yellow-400',
    },
    {
      label: '총 주문 수',
      value: stats?.totalOrders ?? 0,
      icon: '📋',
      color: 'text-purple-400',
    },
    {
      label: '활성 주문',
      value: stats?.activeOrders ?? 0,
      icon: '⚡',
      color: 'text-primary-400',
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">📊 대시보드</h1>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 mb-6 text-danger text-sm">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50"
          >
            <p className="text-sm text-gray-400 mb-1">{card.label}</p>
            <div className="flex items-end gap-2">
              <span className="text-xs">{card.icon}</span>
              <p className={`text-2xl font-bold ${card.color}`}>
                {isLoading ? (
                  <span className="inline-block w-16 h-8 bg-gray-700 rounded animate-pulse" />
                ) : (
                  card.value
                )}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/users"
          className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 hover:border-gray-600 transition group"
        >
          <h2 className="text-lg font-bold mb-2 group-hover:text-primary-400 transition">
            👥 회원 관리
          </h2>
          <p className="text-gray-400 text-sm">유저 목록, 잔고 조회, 방장 7일 실적</p>
        </Link>
        <Link
          href="/tokens"
          className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 hover:border-gray-600 transition group"
        >
          <h2 className="text-lg font-bold mb-2 group-hover:text-primary-400 transition">
            🪙 토큰 관리
          </h2>
          <p className="text-gray-400 text-sm">미니앱 노출 토큰 등록/삭제</p>
        </Link>
        <Link
          href="/transactions"
          className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 hover:border-gray-600 transition group"
        >
          <h2 className="text-lg font-bold mb-2 group-hover:text-primary-400 transition">
            📋 트랜잭션
          </h2>
          <p className="text-gray-400 text-sm">거래 내역 및 Tx Hash 모니터링</p>
        </Link>
      </div>
    </div>
  );
}
