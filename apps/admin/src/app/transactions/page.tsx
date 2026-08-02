'use client';

import { useEffect, useState } from 'react';
import { getOrders, getTokens, getTransfers, getOrderUsers, type AdminTransferResponse, type AdminTransferItem } from '@/lib/api/admin';
import type { AdminOrderDetail, AdminTokenDetail } from '@solwallet/shared-types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active:    { label: '미체결', color: 'bg-blue-500/20 text-blue-400' },
  submitted: { label: '미체결', color: 'bg-blue-500/20 text-blue-400' },
  filled:    { label: '체결',   color: 'bg-success/20 text-success' },
  cancelled: { label: '취소',   color: 'bg-danger/20 text-danger' },
  expired:   { label: '만료',   color: 'bg-gray-600/20 text-gray-400' },
  // failed 매핑이 없어 실패한 주문이 "미체결"로 잘못 표시되던 문제 수정
  failed:    { label: '실패',   color: 'bg-danger/20 text-danger' },
};

/** 상태별 메시지 색상 — 실패/취소는 눈에 띄게, 나머지는 차분하게 */
const MESSAGE_COLOR: Record<string, string> = {
  failed: 'text-danger',
  cancelled: 'text-gray-400',
  expired: 'text-gray-500',
  filled: 'text-success',
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
  const [userFilter, setUserFilter] = useState('');
  const [tokens, setTokens] = useState<AdminTokenDetail[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; label: string }>>([]);

  // 정렬 — 기본값은 최신순
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  useEffect(() => {
    getTokens().then(setTokens).catch(() => {});
    getOrderUsers().then(setUsers).catch(() => {});
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
        userId: userFilter || undefined,
        sortBy,
        sortOrder,
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
  }, [page, statusFilter, tokenFilter, userFilter, sortBy, sortOrder]);

  /** 헤더 클릭 — 같은 칼럼이면 방향 토글, 다른 칼럼이면 내림차순으로 시작 */
  const toggleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const sortIcon = (column: string) =>
    sortBy === column ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : '';

  const formatTxHash = (hash: string | null) => {
    if (!hash) return '—';
    return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
  };

  /**
   * Solscan 트랜잭션 URL 생성.
   *
   * TODO(cluster detection): 현재는 mainnet 기준으로 링크 생성.
   * devnet 여부는 어드민 환경 설정(NEXT_PUBLIC_SOLANA_CLUSTER 등)이나
   * 토큰/주문 메타데이터를 통해 판별할 수 있도록 확장해야 한다.
   * 예: devnet인 경우 `?cluster=devnet` 쿼리 파라미터 추가.
   */
  const SOLSCAN_TX_BASE = 'https://solscan.io/tx';
  const buildSolscanTxUrl = (signature: string): string => {
    // const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
    // const suffix = cluster && cluster !== 'mainnet-beta' ? `?cluster=${cluster}` : '';
    // return `${SOLSCAN_TX_BASE}/${signature}${suffix}`;
    return `${SOLSCAN_TX_BASE}/${signature}`;
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
            <option value="active">미체결</option>
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
        <div>
          <select
            value={userFilter}
            onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500 transition"
          >
            <option value="">전체 유저</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </select>
        </div>
        {(statusFilter || tokenFilter || userFilter) && (
          <button
            onClick={() => { setStatusFilter(''); setTokenFilter(''); setUserFilter(''); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-gray-700 text-sm text-gray-300 hover:bg-gray-600 transition"
          >
            필터 초기화
          </button>
        )}
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
              {/* 메시지 칼럼 폭을 최대한 확보하기 위해 나머지 칼럼은 px-1 + w-0(내용폭)으로 압축.
                  정렬 가능한 헤더는 클릭 시 서버 정렬(같은 칼럼 재클릭 = 방향 토글) */}
              <tr className="border-b border-gray-700">
                <th
                  onClick={() => toggleSort('created_at')}
                  className="text-left py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
                >
                  주문시간{sortIcon('created_at')}
                </th>
                <th className="text-left py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap">마감시간</th>
                <th
                  onClick={() => toggleSort('user_id')}
                  className="text-left py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
                  title="같은 유저의 주문끼리 묶어서 정렬"
                >
                  유저{sortIcon('user_id')}
                </th>
                <th
                  onClick={() => toggleSort('side')}
                  className="text-left py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
                >
                  종류{sortIcon('side')}
                </th>
                <th
                  onClick={() => toggleSort('token_id')}
                  className="text-left py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
                  title="같은 토큰의 주문끼리 묶어서 정렬"
                >
                  토큰{sortIcon('token_id')}
                </th>
                <th
                  onClick={() => toggleSort('price')}
                  className="text-right py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
                >
                  가격{sortIcon('price')}
                </th>
                <th
                  onClick={() => toggleSort('quantity')}
                  className="text-right py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
                >
                  수량{sortIcon('quantity')}
                </th>
                <th
                  onClick={() => toggleSort('fee')}
                  className="text-right py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
                >
                  수수료{sortIcon('fee')}
                </th>
                <th className="text-left py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap">주문 Tx</th>
                <th className="text-left py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap">취소 Tx</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium">메세지</th>
                <th
                  onClick={() => toggleSort('status')}
                  className="text-center py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
                >
                  상태{sortIcon('status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={12} className="text-center py-8 text-gray-400">로딩 중...</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-8 text-gray-400">데이터가 없습니다</td>
                </tr>
              ) : (
                orders.map((order) => {
                  const statusInfo = STATUS_MAP[order.status] || STATUS_MAP.active;
                  return (
                    <tr key={order.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                      <td className="py-2 px-1 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(order.createdAt).toLocaleString('ko-KR')}
                      </td>
                      <td className="py-2 px-1 text-gray-400 text-xs whitespace-nowrap">
                        {order.status === 'filled' && order.updatedAt
                          ? new Date(order.updatedAt).toLocaleString('ko-KR')
                          : '—'}
                      </td>
                      <td className="py-2 px-1 whitespace-nowrap">{order.username}</td>
                      <td className="py-2 px-1">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          order.side === 'buy'
                            ? 'bg-green-600/20 text-green-400'
                            : 'bg-red-600/20 text-red-400'
                        }`}>
                          {order.side === 'buy' ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="py-2 px-1 font-medium whitespace-nowrap">{order.tokenSymbol}</td>
                      <td className="py-2 px-1 text-right font-mono text-xs whitespace-nowrap">{order.price}</td>
                      <td className="py-2 px-1 text-right font-mono text-xs whitespace-nowrap">{order.quantity}</td>
                      <td className="py-2 px-1 text-right text-gray-400 text-xs whitespace-nowrap">{order.fee}</td>
                      <td className="py-2 px-1 font-mono text-xs text-gray-400 whitespace-nowrap">
                        {order.txSignature ? (
                          <a
                            href={buildSolscanTxUrl(order.txSignature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-400 hover:text-primary-300 transition"
                          >
                            {formatTxHash(order.txSignature)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="py-2 px-1 font-mono text-xs text-gray-400 whitespace-nowrap">
                        {order.cancelTxSignature ? (
                          <a
                            href={buildSolscanTxUrl(order.cancelTxSignature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-red-400 hover:text-red-300 transition"
                          >
                            {formatTxHash(order.cancelTxSignature)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className={`py-2 px-2 text-xs ${MESSAGE_COLOR[order.status] || 'text-gray-300'}`}>
                        {order.statusMessage || '—'}
                      </td>
                      <td className="py-2 px-1 text-center">
                        <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${statusInfo.color}`}>
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

      {/* ─── 입출금 내역 (On-chain) ─── */}
      <TransferHistorySection />
    </div>
  );
}

// ─── 입출금 내역 섹션 ───
function TransferHistorySection() {
  const [walletAddress, setWalletAddress] = useState('');
  const [transfers, setTransfers] = useState<AdminTransferItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isLoadingTransfers, setIsLoadingTransfers] = useState(false);
  const [transferError, setTransferError] = useState('');

  const fetchTransfers = async () => {
    if (!walletAddress.trim()) return;
    setIsLoadingTransfers(true);
    setTransferError('');
    try {
      const data = await getTransfers(walletAddress.trim(), 50);
      setTransfers(data.transfers);
      setUserId(data.userId);
      setUserName(data.userName);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : '입출금 내역 조회 실패');
      setTransfers([]);
    } finally {
      setIsLoadingTransfers(false);
    }
  };

  const SOLSCAN_TX_BASE = 'https://solscan.io/tx';
  const formatAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const formatTxHash = (hash: string) => `${hash.slice(0, 8)}...${hash.slice(-4)}`;

  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 mt-6">
      <div className="p-6 pb-0">
        <h2 className="text-lg font-bold mb-3">💳 입출금 내역 (On-chain)</h2>
        <p className="text-xs text-gray-500 mb-3">지갑 주소를 입력하면 SOL / SPL 토큰 입출금 내역을 조회합니다.</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchTransfers()}
            placeholder="지갑 주소 입력..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono outline-none focus:border-primary-500 transition"
          />
          <button
            onClick={fetchTransfers}
            disabled={!walletAddress.trim() || isLoadingTransfers}
            className="px-4 py-2 rounded-lg bg-primary-600 text-sm font-medium text-white disabled:opacity-50 hover:bg-primary-500 transition"
          >
            {isLoadingTransfers ? '조회 중...' : '조회'}
          </button>
        </div>
        {userId && (
          <p className="mt-2 text-xs text-gray-400">
            유저: <span className="text-white font-medium">{userName || '—'}</span>
            {' '}({userId.slice(0, 8)}...)
          </p>
        )}
      </div>

      {transferError && (
        <div className="mx-6 mt-3 bg-danger/10 border border-danger/30 rounded-lg p-3 text-danger text-xs">
          {transferError}
        </div>
      )}

      {transfers.length > 0 && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">발생 날짜</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">유저 ID</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">구분</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">Sender</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">Receiver</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">토큰</th>
                <th className="text-right py-3 px-2 text-gray-400 font-medium whitespace-nowrap">발송 전 잔고</th>
                <th className="text-right py-3 px-2 text-gray-400 font-medium whitespace-nowrap">발송 금액</th>
                <th className="text-right py-3 px-2 text-gray-400 font-medium whitespace-nowrap">발송 후 잔고</th>
                <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">Tx Hash</th>
                <th className="text-center py-3 px-2 text-gray-400 font-medium whitespace-nowrap">상태</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((tr) => (
                <tr key={`${tr.id}-${tr.tokenSymbol}`} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                  <td className="py-2 px-2 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(tr.createdAt).toLocaleString('ko-KR')}
                  </td>
                  <td className="py-2 px-2 text-xs text-gray-400">
                    {userId ? (
                      <span title={userId}>{userId.slice(0, 8)}...</span>
                    ) : '—'}
                  </td>
                  <td className="py-2 px-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      tr.type === 'deposit'
                        ? 'bg-green-600/20 text-green-400'
                        : 'bg-red-600/20 text-red-400'
                    }`}>
                      {tr.type === 'deposit' ? 'Receive' : 'Send'}
                    </span>
                  </td>
                  <td className="py-2 px-2 font-mono text-xs text-gray-300" title={tr.sender}>
                    {formatAddr(tr.sender)}
                  </td>
                  <td className="py-2 px-2 font-mono text-xs text-gray-300" title={tr.receiver}>
                    {formatAddr(tr.receiver)}
                  </td>
                  <td className="py-2 px-2 font-medium">{tr.tokenSymbol}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs text-gray-400">
                    {tr.preBalance.toFixed(tr.tokenSymbol === 'SOL' ? 6 : 2)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs">
                    <span className={tr.type === 'deposit' ? 'text-green-400' : 'text-red-400'}>
                      {tr.type === 'deposit' ? '+' : '-'}{tr.amount.toFixed(tr.tokenSymbol === 'SOL' ? 6 : 2)}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs text-gray-400">
                    {tr.postBalance.toFixed(tr.tokenSymbol === 'SOL' ? 6 : 2)}
                  </td>
                  <td className="py-2 px-2 font-mono text-xs text-gray-400">
                    <a
                      href={`${SOLSCAN_TX_BASE}/${tr.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-400 hover:text-primary-300 transition"
                    >
                      {formatTxHash(tr.id)}
                    </a>
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {walletAddress && !isLoadingTransfers && transfers.length === 0 && !transferError && (
        <div className="text-center py-6 text-gray-400 text-sm">입출금 내역이 없습니다.</div>
      )}
    </div>
  );
}
