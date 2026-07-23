'use client';

import { useEffect, useState, useCallback } from 'react';
import { getRevenue, type RevenueEntry } from '@/lib/api/admin';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active: { label: '활성', color: 'bg-blue-500/20 text-blue-400' },
  submitted: { label: '제출됨', color: 'bg-yellow-500/20 text-yellow-400' },
  filled: { label: '체결', color: 'bg-green-500/20 text-green-400' },
  cancelled: { label: '취소', color: 'bg-red-500/20 text-red-400' },
  expired: { label: '만료', color: 'bg-gray-600/20 text-gray-400' },
  failed: { label: '실패', color: 'bg-red-700/20 text-red-500' },
};

export default function RevenuePage() {
  const [ledger, setLedger] = useState<RevenueEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  const loadRevenue = useCallback(async (targetPage: number) => {
    setIsLoading(true);
    setError('');
    try {
      const data = await getRevenue(targetPage, pageSize);
      setLedger(data.ledger);
      setTotal(data.total);
      setTotalRevenue(data.totalRevenue);
    } catch (err) {
      setError(err instanceof Error ? err.message : '조회 실패');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRevenue(1);
  }, [loadRevenue]);

  const fmt = (val: string | number, digits = 2) => {
    const n = Number(val);
    return Number.isFinite(n) ? n.toFixed(digits) : '—';
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">💰 수수료 정산</h1>

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-800 rounded-xl p-5">
          <p className="text-xs text-gray-400 mb-1">총 수수료 수익</p>
          <p className="text-2xl font-bold text-green-400">
            ${fmt(totalRevenue, 4)}
          </p>
        </div>
        <div className="bg-gray-800 rounded-xl p-5">
          <p className="text-xs text-gray-400 mb-1">수수료 발생 건수</p>
          <p className="text-2xl font-bold">{total.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-5">
          <p className="text-xs text-gray-400 mb-1">건당 평균 수수료</p>
          <p className="text-2xl font-bold text-primary-400">
            ${total > 0 ? fmt(totalRevenue / total, 4) : '0.00'}
          </p>
        </div>
      </div>

      {error && (
        <p className="text-red-400 mb-4">{error}</p>
      )}

      {/* 정산 테이블 */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-3 px-4 text-left font-medium">시간</th>
                <th className="py-3 px-4 text-left font-medium">사용자</th>
                <th className="py-3 px-4 text-left font-medium">거래</th>
                <th className="py-3 px-4 text-right font-medium">거래금액</th>
                <th className="py-3 px-4 text-right font-medium">수수료율</th>
                <th className="py-3 px-4 text-right font-medium">수수료</th>
                <th className="py-3 px-4 text-center font-medium">상태</th>
                <th className="py-3 px-4 text-left font-medium">TX</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-400">불러오는 중...</td>
                </tr>
              ) : ledger.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-400">수수료 발생 내역이 없습니다.</td>
                </tr>
              ) : (
                ledger.map((entry) => {
                  const status = STATUS_MAP[entry.status] || { label: entry.status, color: 'bg-gray-600/20 text-gray-400' };
                  return (
                    <tr key={entry.orderId} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">
                        {fmtDate(entry.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium">{entry.username}</span>
                        {entry.telegramUid && (
                          <span className="text-xs text-gray-500 ml-1">({entry.telegramUid})</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded mr-1.5 ${
                          entry.side === 'buy' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                        }`}>
                          {entry.side === 'buy' ? 'BUY' : 'SELL'}
                        </span>
                        <span className="font-medium">{entry.tokenSymbol}</span>
                        <span className="text-gray-500 ml-1.5 text-xs">
                          {fmt(entry.price, 4)} × {fmt(entry.quantity, 4)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-gray-300">
                        ${fmt(entry.tradeAmount, 2)}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-400">
                        {(Number(entry.feeRate) * 100).toFixed(2)}%
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-green-400">
                        ${fmt(entry.fee, 6)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded ${status.color}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {entry.txSignature ? (
                          <a
                            href={`https://solscan.io/tx/${entry.txSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-400 hover:underline"
                          >
                            {entry.txSignature.slice(0, 8)}...
                          </a>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-400">
            {page} / {totalPages} 페이지 (총 {total}건)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { const p = Math.max(1, page - 1); setPage(p); loadRevenue(p); }}
              disabled={page === 1 || isLoading}
              className="px-3 py-1.5 rounded-lg bg-gray-700 text-sm disabled:opacity-50 hover:bg-gray-600 transition"
            >
              이전
            </button>
            <button
              onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); loadRevenue(p); }}
              disabled={page === totalPages || isLoading}
              className="px-3 py-1.5 rounded-lg bg-gray-700 text-sm disabled:opacity-50 hover:bg-gray-600 transition"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
