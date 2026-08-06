'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDashboard, getDashboardNocache } from '@/lib/api/admin';
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
/** 입금 잔고·입금액 — 소수점 5자리까지 표시 */
const formatUsdt5 = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`;

export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  /** 오늘 입금액 수동 새로고침 — 캐시 무시 */
  const refreshDeposit = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const fresh = await getDashboardNocache();
      setData(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : '새로고침 실패');
    } finally {
      setIsRefreshing(false);
    }
  };

  const statCards = [
    { label: '총 입금 잔고 (USDT)', value: data ? formatUsdt5(data.totalDepositUsdt) : '$0.00', icon: '🏦', color: 'text-emerald-400', subLabel: '순수 USDT+USDC', subValue: data ? formatUsdt5(data.pureUsdtBalance) : '$0.00', subColor: 'text-gray-400' },
    { label: '오늘 입금액 (USDT)', value: data ? formatUsdt5(data.todayDepositUsdt) : '$0.00', icon: '📥', color: 'text-teal-400', refresh: true },
    { label: '오늘 출금액 (USDT)', value: data ? formatUsdt5(data.todayWithdrawalUsdt) : '$0.00', icon: '📤', color: 'text-red-400' },
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
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-gray-400">{card.label}</p>
              {'refresh' in card && (
                <button
                  type="button"
                  onClick={refreshDeposit}
                  disabled={isRefreshing}
                  className="text-gray-500 hover:text-teal-400 transition-colors disabled:opacity-50"
                  title="오늘 입금액 새로고침"
                >
                  <svg
                    className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex items-end gap-2">
              <span className="text-xs">{card.icon}</span>
              <div>
                <p className={`text-2xl font-bold ${card.color}`}>
                  {isLoading ? (
                    <span className="inline-block w-16 h-8 bg-gray-700 rounded animate-pulse" />
                  ) : (
                    card.value
                  )}
                </p>
                {'subLabel' in card && (
                  <p className="text-xs mt-0.5">
                    <span className="text-gray-500">{(card as { subLabel: string }).subLabel}: </span>
                    <span className={(card as { subColor?: string }).subColor || 'text-gray-400'}>
                      {isLoading ? (
                        <span className="inline-block w-12 h-3 bg-gray-700 rounded animate-pulse" />
                      ) : (
                        (card as { subValue: string }).subValue
                      )}
                    </span>
                  </p>
                )}
              </div>
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

      {/* ─── 오늘의 입출금 내역 ─── */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 mb-6">
        <div className="p-6 pb-0 flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">💳 오늘의 입출금 내역</h2>
          <span className="text-sm text-gray-400">총 {data?.todayTransfers.length ?? 0}건</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">시간</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">유저</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">구분</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">토큰</th>
                <th className="text-right py-3 px-2 text-gray-400 font-medium whitespace-nowrap">금액</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">Tx Hash</th>
                <th className="text-center py-3 px-2 text-gray-400 font-medium whitespace-nowrap">상태</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">로딩 중...</td></tr>
              ) : !data || data.todayTransfers.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">오늘 발생한 입출금이 없습니다</td></tr>
              ) : (
                data.todayTransfers.map((tr) => (
                  <tr key={`${tr.walletAddress}-${tr.id}-${tr.tokenSymbol}`} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                    <td className="py-2 px-2 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(tr.createdAt).toLocaleTimeString('ko-KR')}
                    </td>
                    <td className="py-2 px-2 text-xs whitespace-nowrap" title={tr.walletAddress}>
                      {tr.userName}
                    </td>
                    <td className="py-2 px-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        tr.type === 'deposit'
                          ? 'bg-green-600/20 text-green-400'
                          : tr.type === 'fee'
                            ? 'bg-gray-600/20 text-gray-400'
                            : 'bg-red-600/20 text-red-400'
                      }`}>
                        {tr.type === 'deposit' ? 'Receive' : tr.type === 'fee' ? 'Fee' : 'Send'}
                      </span>
                    </td>
                    <td className="py-2 px-2 font-medium">{tr.tokenSymbol}</td>
                    <td className="py-2 px-2 text-right font-mono text-xs">
                      <span className={tr.type === 'deposit' ? 'text-green-400' : tr.type === 'fee' ? 'text-gray-400' : 'text-red-400'}>
                        {tr.type === 'deposit' ? '+' : '-'}{tr.amount.toFixed(tr.tokenSymbol === 'SOL' ? 6 : 2)}
                      </span>
                    </td>
                    <td className="py-2 px-2 font-mono text-xs text-gray-400">
                      {tr.id ? (
                        <a
                          href={`${SOLSCAN_TX_BASE}/${tr.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-400 hover:text-primary-300 transition"
                        >
                          {formatTxHash(tr.id)}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        tr.status === 'completed'
                          ? 'bg-success/20 text-success'
                          : 'bg-danger/20 text-danger'
                      }`}>
                        {tr.status === 'completed' ? '완료' : '실패'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
