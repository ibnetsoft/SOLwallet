'use client';

import { useEffect, useState } from 'react';
import {
  getOrders,
  getTokens,
  getAllTransfers,
  type AdminAllTransferItem,
} from '@/lib/api/admin';
import type { AdminOrderDetail, AdminTokenDetail } from '@solwallet/shared-types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active:            { label: '미체결', color: 'bg-blue-500/20 text-blue-400' },
  submitted:         { label: '미체결', color: 'bg-blue-500/20 text-blue-400' },
  partially_filled:  { label: '부분체결', color: 'bg-amber-500/20 text-amber-400' },
  filled:            { label: '체결',   color: 'bg-success/20 text-success' },
  cancelled:         { label: '취소',   color: 'bg-orange-500/20 text-orange-400' },
  expired:           { label: '만료',   color: 'bg-gray-600/20 text-gray-400' },
  // failed 매핑이 없어 실패한 주문이 "미체결"로 잘못 표시되던 문제 수정
  failed:            { label: '실패',   color: 'bg-danger/20 text-danger' },
};

/** 상태별 메시지 색상 — 실패/취소는 눈에 띄게, 나머지는 차분하게 */
const MESSAGE_COLOR: Record<string, string> = {
  failed: 'text-danger',
  cancelled: 'text-gray-400',
  expired: 'text-gray-500',
  partially_filled: 'text-amber-400',
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
  /** 실제 조회에 적용된 유저 검색어 */
  const [userFilter, setUserFilter] = useState('');
  /** 입력창의 현재 값 — 엔터/검색을 눌러야 userFilter에 반영 (타이핑마다 조회하지 않도록) */
  const [userInput, setUserInput] = useState('');
  const [userNotFound, setUserNotFound] = useState(false);
  const [tokens, setTokens] = useState<AdminTokenDetail[]>([]);

  // 정렬 — 기본값은 최신순
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // 상단 탭 — 주문 내역 / 입출금 내역을 위아래로 쌓지 않고 탭으로 전환
  const [activeTab, setActiveTab] = useState<'orders' | 'transfers'>('orders');

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
        user: userFilter || undefined,
        sortBy,
        sortOrder,
      });
      setOrders(data.orders);
      setTotal(data.total);
      setUserNotFound(!!data.userNotFound);
    } catch (err) {
      setError(err instanceof Error ? err.message : '주문 조회 실패');
    } finally {
      setIsLoading(false);
    }
  };

  /** 입력창의 검색어를 실제 필터로 적용 */
  const applyUserFilter = () => {
    setUserFilter(userInput.trim());
    setPage(1);
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

      {/* 탭 — 주문 내역 / 입출금 내역 */}
      <div className="flex gap-1 border-b border-gray-700 mb-6">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === 'orders'
              ? 'border-primary-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          주문 내역
        </button>
        <button
          onClick={() => setActiveTab('transfers')}
          className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            activeTab === 'transfers'
              ? 'border-primary-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          입출금 내역
        </button>
      </div>

      {activeTab === 'orders' && (
      <>
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
                <option value="partially_filled">부분체결</option>
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
        {/* 유저 검색 — Tele ID(username) / 숫자 UID / 추천코드 모두 인식 */}
        <div className="flex gap-1">
          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyUserFilter()}
            placeholder="Tele ID 입력..."
            className={`bg-gray-800 border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500 transition w-44 ${
              userNotFound ? 'border-danger' : 'border-gray-700'
            }`}
          />
          <button
            onClick={applyUserFilter}
            className="px-3 py-2 rounded-lg bg-primary-600 text-sm text-white hover:bg-primary-500 transition"
          >
            검색
          </button>
        </div>
        {(statusFilter || tokenFilter || userFilter) && (
          <button
            onClick={() => {
              setStatusFilter('');
              setTokenFilter('');
              setUserFilter('');
              setUserInput('');
              setUserNotFound(false);
              setPage(1);
            }}
            className="px-3 py-2 rounded-lg bg-gray-700 text-sm text-gray-300 hover:bg-gray-600 transition"
          >
            필터 초기화
          </button>
        )}
      </div>

      {/* 검색어에 해당하는 유저가 없을 때 — "주문 0건"과 구분해서 안내 */}
      {userNotFound && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-3 mb-6 text-danger text-sm">
          &apos;{userFilter}&apos; 에 해당하는 회원을 찾을 수 없습니다. Tele ID / 숫자 UID / 추천코드로 검색해보세요.
        </div>
      )}

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
                <th className="text-right py-3 px-1 w-0 text-gray-400 font-medium whitespace-nowrap">
                  체결수량
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
                  <td colSpan={13} className="text-center py-8 text-gray-400">로딩 중...</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-8 text-gray-400">데이터가 없습니다</td>
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
                        {(order.status === 'filled' || order.status === 'partially_filled' || order.status === 'cancelled' || order.status === 'expired') && order.updatedAt
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
                      <td className="py-2 px-1 text-right font-mono text-xs whitespace-nowrap">
                        {Number(order.filledQty) > 0 ? (
                          <span className={order.status === 'partially_filled' ? 'text-amber-400' : 'text-gray-300'}>
                            {String(order.filledQty)}
                          </span>
                        ) : (
                          <span className="text-gray-500">0</span>
                        )}
                      </td>
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
      </>
      )}

      {activeTab === 'transfers' && <TransferHistorySection />}
    </div>
  );
}

// ─── 입출금 내역 섹션 ───
// 활성 지갑 전체를 온체인에서 실시간 스캔해 한 번에 보여준다(가벼운 실시간 조회 —
// 지갑 수가 늘어나면 백그라운드 인덱싱 방식으로 전환 필요, 지금은 테스트 규모라 충분).
type TransferSortKey = 'createdAt' | 'userName' | 'type' | 'tokenSymbol' | 'amount';

function TransferHistorySection() {
  const [transfers, setTransfers] = useState<AdminAllTransferItem[]>([]);
  const [isLoadingTransfers, setIsLoadingTransfers] = useState(true);
  const [transferError, setTransferError] = useState('');

  // 입금/출금 따로 볼 수 있는 필터
  const [typeFilter, setTypeFilter] = useState<'all' | 'deposit' | 'withdraw' | 'fee'>('all');
  // 유저명/지갑주소로 간단히 좁혀보기 (전체 조회 후 클라이언트에서 필터)
  const [search, setSearch] = useState('');

  // 정렬 — 전부 클라이언트 사이드(이미 한 번에 다 불러온 가벼운 조회라 서버 정렬 불필요)
  const [sortBy, setSortBy] = useState<TransferSortKey>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const fetchTransfers = async () => {
    setIsLoadingTransfers(true);
    setTransferError('');
    try {
      const data = await getAllTransfers(20);
      setTransfers(data);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : '입출금 내역 조회 실패');
      setTransfers([]);
    } finally {
      setIsLoadingTransfers(false);
    }
  };

  useEffect(() => {
    fetchTransfers();
  }, []);

  const toggleSort = (column: TransferSortKey) => {
    if (sortBy === column) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const sortIcon = (column: TransferSortKey) =>
    sortBy === column ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : '';

  const displayed = transfers
    .filter((tr) => typeFilter === 'all' || tr.type === typeFilter)
    .filter((tr) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return tr.userName.toLowerCase().includes(q) || tr.walletAddress.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'createdAt') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      else if (sortBy === 'amount') cmp = a.amount - b.amount;
      else cmp = String(a[sortBy]).localeCompare(String(b[sortBy]));
      return sortOrder === 'asc' ? cmp : -cmp;
    });

  const depositCount = transfers.filter((t) => t.type === 'deposit').length;
  const withdrawCount = transfers.filter((t) => t.type === 'withdraw').length;
  const feeCount = transfers.filter((t) => t.type === 'fee').length;

  const SOLSCAN_TX_BASE = 'https://solscan.io/tx';
  const formatAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const formatTxHash = (hash: string) => `${hash.slice(0, 8)}...${hash.slice(-4)}`;

  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50">
      <div className="p-6 pb-0 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold">💳 입출금 내역 (On-chain)</h2>
          <p className="text-xs text-gray-500 mt-1">
            활성 지갑 전체 기준 · 입금 {depositCount}건 · 출금 {withdrawCount}건 · 수수료 {feeCount}건
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | 'deposit' | 'withdraw' | 'fee')}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500 transition"
          >
            <option value="all">전체</option>
            <option value="deposit">입금만</option>
            <option value="withdraw">출금만</option>
            <option value="fee">수수료만</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="유저명 / 지갑주소 검색..."
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500 transition w-52"
          />
          <button
            onClick={fetchTransfers}
            disabled={isLoadingTransfers}
            className="px-4 py-2 rounded-lg bg-primary-600 text-sm font-medium text-white disabled:opacity-50 hover:bg-primary-500 transition"
          >
            {isLoadingTransfers ? '조회 중...' : '새로고침'}
          </button>
        </div>
      </div>

      {transferError && (
        <div className="mx-6 mt-3 bg-danger/10 border border-danger/30 rounded-lg p-3 text-danger text-xs">
          {transferError}
        </div>
      )}

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th
                onClick={() => toggleSort('createdAt')}
                className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
              >
                발생 날짜{sortIcon('createdAt')}
              </th>
              <th
                onClick={() => toggleSort('userName')}
                className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
              >
                유저{sortIcon('userName')}
              </th>
              <th
                onClick={() => toggleSort('type')}
                className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
              >
                구분{sortIcon('type')}
              </th>
              <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">Sender</th>
              <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">Receiver</th>
              <th
                onClick={() => toggleSort('tokenSymbol')}
                className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
              >
                토큰{sortIcon('tokenSymbol')}
              </th>
              <th
                onClick={() => toggleSort('amount')}
                className="text-right py-3 px-2 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition"
              >
                금액{sortIcon('amount')}
              </th>
              <th className="text-left py-3 px-2 text-gray-400 font-medium whitespace-nowrap">Tx Hash</th>
              <th className="text-center py-3 px-2 text-gray-400 font-medium whitespace-nowrap">상태</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingTransfers ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-gray-400">조회 중...</td>
              </tr>
            ) : displayed.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-gray-400">입출금 내역이 없습니다.</td>
              </tr>
            ) : (
              displayed.map((tr) => (
                <tr key={`${tr.walletAddress}-${tr.id}-${tr.tokenSymbol}`} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                  <td className="py-2 px-2 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(tr.createdAt).toLocaleString('ko-KR')}
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
                  <td className="py-2 px-2 font-mono text-xs text-gray-300" title={tr.sender}>
                    {formatAddr(tr.sender)}
                  </td>
                  <td className="py-2 px-2 font-mono text-xs text-gray-300" title={tr.receiver}>
                    {formatAddr(tr.receiver)}
                  </td>
                  <td className="py-2 px-2 font-medium">{tr.tokenSymbol}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs">
                    <span className={tr.type === 'deposit' ? 'text-green-400' : tr.type === 'fee' ? 'text-gray-400' : 'text-red-400'}>
                      {tr.type === 'deposit' ? '+' : '-'}{tr.amount.toFixed(tr.tokenSymbol === 'SOL' ? 6 : 2)}
                    </span>
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
