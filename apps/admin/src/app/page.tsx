'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDashboard } from '@/lib/api/admin';
import type { AdminDashboard } from '@solwallet/shared-types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active:    { label: '미체결', color: 'bg-blue-500/20 text-blue-400' },
  submitted: { label: '미체결', color: 'bg-blue-500/20 text-blue-400' },
  filled:    { label: '체결',   color: 'bg-success/20 text-success' },
  cancelled: { label: '취소',   color: 'bg-orange-500/20 text-orange-400' },
  expired:   { label: '만료',   color: 'bg-gray-600/20 text-gray-400' },
  failed:    { label: '실패',   color: 'bg-danger/20 text-danger' },
};

const SOLSCAN_TX_BASE = 'https://solscan.io/tx';
const formatTxHash = (hash: string) => `${hash.slice(0, 8)}...${hash.slice(-4)}`;
const formatUsdt = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchDashboard() {
      try {
        setData(await getDashboard());
      } catch (err) {
        setError(err instanceof Error ? err.message : '대시보드 조회 실패');
      } finally {
        setIsLoading(false);
      }
    }
    fetchDashboard();
  }, []);

  const statCards = [
    { label: '총 입금 잔고 (USDT)', value: data ? formatUsdt(data.totalDepositUsdt) : '$0.00', icon: '🏦', color: 'text-emerald-400' },
    { label: '오늘 입금액 (USDT)', value: data ? formatUsdt(data.todayDepositUsdt) : '$0.00', icon: '📥', color: 'text-teal-400' },
    { label: '총 가입 유저', value: data?.totalUsers ?? 0, icon: '👥', color: 'text-blue-400' },
    { label: '오늘 신규 가입', value: data?.todaySignups ?? 0, icon: '📈', color: 'text-green-400' },
    { label: '수수료 수익 (USDT)', value: data ? `$${data.totalFeeRevenue.toFixed(2)}` : '$0.00', icon: '💰', color: 'text-yellow-400' },
    { label: '총 주문 수', value: data?.totalOrders ?? 0, icon: '📋', color: 'text-purple-400' },
    { label: '활성 주문', value: data?.activeOrders ?? 0, icon: '⚡', color: 'text-primary-400' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">📊 대시보드</h1>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 mb-6 text-danger text-sm">
          {error}
        </div>
      )}

      {/* 입금 집계가 RPC 오류로 일부만 반영된 경우 — 수치를 오해하지 않도록 명시 */}
      {data?.depositStatsPartial && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 mb-6 text-yellow-400 text-xs">
          ⚠️ 입금 집계 중 일부 조회에 실패해 실제 금액보다 적게 표시될 수 있습니다 (RPC 응답 지연/제한).
          잠시 후 새로고침하면 정확한 값이 표시됩니다.
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
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

      {/* ─── 오늘 가입한 회원 ─── */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 mb-6">
        <div className="p-6 pb-0 flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">👥 오늘 가입한 회원</h2>
          <span className="text-sm text-gray-400">총 {data?.todayUsers.length ?? 0}명</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-center py-3 px-4 text-gray-400 font-medium whitespace-nowrap">가입시간</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium whitespace-nowrap">Tele ID</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium whitespace-nowrap">닉네임</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium whitespace-nowrap">스폰서</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium whitespace-nowrap">추천코드</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">로딩 중...</td></tr>
              ) : !data || data.todayUsers.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">오늘 가입한 회원이 없습니다</td></tr>
              ) : (
                data.todayUsers.map((u) => (
                  <tr key={u.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                    <td className="py-3 px-4 text-center text-gray-400 text-xs whitespace-nowrap">
                      {new Date(u.createdAt).toLocaleTimeString('ko-KR')}
                    </td>
                    <td className="py-3 px-4 font-medium text-sm">
                      {u.username || u.firstName || u.telegramUid}
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs">{u.adminNickname || '—'}</td>
                    <td className="py-3 px-4 text-center font-mono text-xs text-gray-400">
                      {u.sponsorTeleId || '—'}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-xs text-gray-400">
                      {u.referralCode || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── 오늘의 트랜잭션 ─── */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 mb-6">
        <div className="p-6 pb-0 flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">📋 오늘의 트랜잭션</h2>
          <span className="text-sm text-gray-400">총 {data?.todayOrders.length ?? 0}건</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">주문시간</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium">유저</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium">종류</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium">토큰</th>
                <th className="text-right py-3 px-2 text-gray-400 font-medium">가격</th>
                <th className="text-right py-3 px-2 text-gray-400 font-medium">수량</th>
                <th className="text-right py-3 px-2 text-gray-400 font-medium">수수료</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium">Tx Hash</th>
                <th className="text-center py-3 px-2 text-gray-400 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">로딩 중...</td></tr>
              ) : !data || data.todayOrders.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">오늘 발생한 트랜잭션이 없습니다</td></tr>
              ) : (
                data.todayOrders.map((o) => {
                  const statusInfo = STATUS_MAP[o.status] || STATUS_MAP.active;
                  return (
                    <tr key={o.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                      <td className="py-2 px-2 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(o.createdAt).toLocaleTimeString('ko-KR')}
                      </td>
                      <td className="py-2 px-2">{o.username}</td>
                      <td className="py-2 px-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          o.side === 'buy' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                        }`}>
                          {o.side === 'buy' ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="py-2 px-2 font-medium">{o.tokenSymbol}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs">{o.price}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs">{o.quantity}</td>
                      <td className="py-2 px-2 text-right text-gray-400 text-xs">{o.fee}</td>
                      <td className="py-2 px-2 font-mono text-xs text-gray-400">
                        {o.txSignature ? (
                          <a
                            href={`${SOLSCAN_TX_BASE}/${o.txSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-400 hover:text-primary-300 transition"
                          >
                            {formatTxHash(o.txSignature)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className={`text-xs px-2 py-1 rounded-full ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── 오늘의 입금액 ─── */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">📥 오늘의 입금액</h2>
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-bold text-teal-400">
            {isLoading ? (
              <span className="inline-block w-40 h-10 bg-gray-700 rounded animate-pulse" />
            ) : (
              formatUsdt(data?.todayDepositUsdt ?? 0)
            )}
          </span>
          <span className="text-sm text-gray-400">USDT 기준 환산</span>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          전체 회원 지갑으로 오늘 들어온 입금을 온체인에서 집계한 값입니다.
          SOL은 실시간 시세로, USDT/USDC는 1:1로 환산됩니다. (시세 정보가 없는 토큰은 제외)
        </p>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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
        <Link
          href="/referral-tree"
          className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 hover:border-gray-600 transition group"
        >
          <h2 className="text-lg font-bold mb-2 group-hover:text-primary-400 transition">
            🌳 추천 조직도
          </h2>
          <p className="text-gray-400 text-sm">다단계 추천 조직 트리 조회</p>
        </Link>
      </div>
    </div>
  );
}
