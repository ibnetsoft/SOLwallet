'use client';

import { useEffect, useState } from 'react';
import { getOrders, getTokens } from '@/lib/api/admin';
import type { AdminOrderDetail, AdminTokenDetail } from '@solwallet/shared-types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active: { label: '활성', color: 'bg-blue-500/20 text-blue-400' },
  filled: { label: '체결', color: 'bg-success/20 text-success' },
  cancelled: { label: '취소', color: 'bg-danger/20 text-danger' },
  expired: { label: '만료', color: 'bg-gray-600/20 text-gray-400' },
};

export default function TransactionsPage() {
  const [orders, setOrders] = useState<AdminOrderDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // 필터
  const [statusFilter, setStatusFilter] = useState('');
  const [tokenFilter, setTokenFilter] = useState('');
  const [tokens, setTokens] = useState<AdminTokenDetail[]>([]);

  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  useEffect(() => {
    getTokens().then(setTokens).catch(() => {});
  }, []);

  const fetchOrders = async (p: number) => {
    setIsLoading(true);
    setError('');
    try {
      const data = await getOrders({
        page: p,
        pageSize,
        status: statusFilter || undefined,
        tokenId: tokenFilter || undefined,
      });
      setOrders(data.orders);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '주문 조회 실패');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders(page);
  }, [page, statusFilter, tokenFilter]);

  const formatTxHash = (hash: string | null) => {
    if (!hash) return '—';
    return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">📋 트랜잭션 모니터링</h1>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 mb-6 text-danger text-sm">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500 transition"
          >
            <option value="">전체 상태</option>
            <option value="active">활성</option>
            <option value="filled">체결</option>
            <option value="cancelled">취소</option>
            <option value="expired">만료</option>
          </select>
        </div>
        <div>
          <select
            value={tokenFilter}
            onChange={(e) => { setTokenFilter(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500 transition"
          >
            <option value="">전체 토큰</option>
            {tokens.map((t) => (
              <option key={t.id} value={t.id}>{t.symbol}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50">
        <div className="p-6 pb-0 flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">주문 내역</h2>
          <span className="text-sm text-gray-400">총 {total}건</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-400 font-medium">시간</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">유저</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">종류</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">토큰</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">가격</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">수량</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">수수료</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Tx Hash</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-400">로딩 중...</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-400">데이터가 없습니다</td>
                </tr>
              ) : (
                orders.map((order) => {
                  const statusInfo = STATUS_MAP[order.status] || STATUS_MAP.active;
                  return (
                    <tr key={order.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                      <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(order.createdAt).toLocaleString('ko-KR')}
                      </td>
                      <td className="py-3 px-4">{order.username}</td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          order.side === 'buy'
                            ? 'bg-green-600/20 text-green-400'
                            : 'bg-red-600/20 text-red-400'
                        }`}>
                          {order.side === 'buy' ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium">{order.tokenSymbol}</td>
                      <td className="py-3 px-4 text-right font-mono text-xs">{order.price}</td>
                      <td className="py-3 px-4 text-right font-mono text-xs">{order.quantity}</td>
                      <td className="py-3 px-4 text-right text-gray-400 text-xs">{order.fee}</td>
                      <td className="py-3 px-4 font-mono text-xs text-gray-400">
                        {order.txSignature ? (
                          <a
                            href={`https://solscan.io/tx/${order.txSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-400 hover:text-primary-300 transition"
                          >
                            {formatTxHash(order.txSignature)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-4 text-center">
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 p-4 border-t border-gray-700">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1.5 rounded-lg bg-gray-700 text-sm disabled:opacity-50 hover:bg-gray-600 transition"
            >
              이전
            </button>
            <span className="text-sm text-gray-400">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 rounded-lg bg-gray-700 text-sm disabled:opacity-50 hover:bg-gray-600 transition"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
