'use client';

import { useEffect, useState } from 'react';
import { getUsers, getUserWallets, getReferralStats, getTokens, getUserBalance, toggleSponsor, deleteUsers, setUserSponsor, setUserNickname } from '@/lib/api/admin';
import type { ReferralStat, AdminWalletDetail } from '@/lib/api/admin';
import type { AdminUserDetail, AdminTokenDetail } from '@solwallet/shared-types';

function UserRow({
  user,
  tokens,
  selectedUserId,
  checked,
  onToggleCheck,
  onViewWallets,
  onToggleSponsor,
  onSetSponsor,
  onSetNickname,
}: {
  user: AdminUserDetail;
  tokens: AdminTokenDetail[];
  selectedUserId: string | null;
  checked: boolean;
  onToggleCheck: (id: string) => void;
  onViewWallets: (id: string) => void;
  onToggleSponsor: (userId: string) => Promise<void>;
  onSetSponsor: (userId: string, telegramUid: number) => Promise<void>;
  onSetNickname: (userId: string, nickname: string) => Promise<void>;
}) {
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [isSponsor, setIsSponsor] = useState((user as any).isSponsor ?? false);
  const [sponsorInput, setSponsorInput] = useState('');
  const [savingSponsor, setSavingSponsor] = useState(false);
  const [nicknameInput, setNicknameInput] = useState(user.adminNickname || '');
  const [savedNickname, setSavedNickname] = useState(user.adminNickname || '');
  const [savingNickname, setSavingNickname] = useState(false);

  const handleSaveNickname = async () => {
    setSavingNickname(true);
    try {
      await onSetNickname(user.id, nicknameInput);
      setSavedNickname(nicknameInput);
    } catch (e) {
      alert(e instanceof Error ? e.message : '닉네임 저장 실패');
    } finally {
      setSavingNickname(false);
    }
  };

  const handleSaveSponsor = async () => {
    if (!sponsorInput.trim()) return;
    setSavingSponsor(true);
    try {
      await onSetSponsor(user.id, Number(sponsorInput.trim()));
      setSponsorInput('');
    } catch (e) {
      alert(e instanceof Error ? e.message : '스폰서 지정 실패');
    } finally {
      setSavingSponsor(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    getUserBalance(user.id)
      .then((res) => {
        if (!mounted) return;
        const newBalances: Record<string, number> = {};
        res.wallets.forEach((w) => {
          // SOL 잔고는 w.sol에 별도 저장 (SPL 토큰이 아님)
          const SOL_MINT = 'So11111111111111111111111111111111111111112';
          newBalances[SOL_MINT] = (newBalances[SOL_MINT] || 0) + (w.sol || 0);
          // SPL 토큰 잔고
          w.tokens?.forEach((t: any) => {
            newBalances[t.mint] = (newBalances[t.mint] || 0) + t.balance;
          });
        });
        setBalances(newBalances);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [user.id]);

  return (
    <tr className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
      <td className="py-3 px-4 text-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleCheck(user.id)}
          className="w-4 h-4 rounded border-gray-600 bg-gray-700 accent-primary-600 cursor-pointer"
        />
      </td>
      <td className="py-3 px-4 text-center text-gray-400 text-xs whitespace-nowrap">
        {new Date(user.createdAt).toLocaleDateString('ko-KR')}
      </td>
      <td className="py-3 px-4 text-center text-gray-400 text-xs whitespace-nowrap">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('ko-KR') : '—'}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{user.username || user.firstName || user.telegramUid}</span>
        </div>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          <input
            type="text"
            placeholder="닉네임"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveNickname()}
            className="w-24 bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-primary-500"
          />
          {nicknameInput !== savedNickname && (
            <button
              onClick={handleSaveNickname}
              disabled={savingNickname}
              className="text-[10px] px-2 py-1 rounded bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 disabled:opacity-40 transition"
            >
              {savingNickname ? '...' : '저장'}
            </button>
          )}
        </div>
      </td>
      <td className="py-3 px-4 text-gray-400 font-mono text-xs text-center">
        {user.sponsorTeleId ? (
          user.sponsorTeleId
        ) : (
          <div className="flex items-center justify-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Tele ID"
              value={sponsorInput}
              onChange={(e) => setSponsorInput(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveSponsor()}
              className="w-20 bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-xs text-center focus:outline-none focus:border-primary-500"
            />
            <button
              onClick={handleSaveSponsor}
              disabled={savingSponsor || !sponsorInput.trim()}
              className="text-[10px] px-2 py-1 rounded bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 disabled:opacity-40 transition"
            >
              {savingSponsor ? '...' : '저장'}
            </button>
          </div>
        )}
      </td>
      <td className="py-3 px-4 text-gray-400 font-mono text-xs text-center">{user.referralCode || '—'}</td>
      <td className="py-3 px-4 text-center text-gray-400 font-mono text-xs">{user.totalReferrals || 0}</td>
      <td className="py-3 px-1 w-9 text-center text-gray-400 font-mono text-xs">{user.level1Referrals || 0}</td>
      <td className="py-3 px-1 w-9 text-center text-gray-400 font-mono text-xs">{user.level2Referrals || 0}</td>
      <td className="py-3 px-1 w-9 text-center text-gray-400 font-mono text-xs">{user.level3Referrals || 0}</td>
      <td className="py-3 px-1 w-9 text-center text-gray-400 font-mono text-xs">{user.level4Referrals || 0}</td>
      <td className="py-3 px-1 w-9 text-center text-gray-400 font-mono text-xs">{user.level5Referrals || 0}</td>
      {tokens.map((t) => (
        <td key={t.id} className="py-3 px-4 text-right text-gray-400 font-mono text-xs">
          {loading ? '...' : (balances[t.mintAddress] || 0).toFixed(4)}
        </td>
      ))}
      <td className="py-3 px-4 text-right whitespace-nowrap">
        <button
          onClick={() => onViewWallets(user.id)}
          className="text-xs px-3 py-1.5 rounded-lg bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 transition"
        >
          {selectedUserId === user.id ? '닫기' : '지갑보기'}
        </button>
        <button
          onClick={async () => {
            try {
              await toggleSponsor(user.id);
              setIsSponsor(!isSponsor);
            } catch (e) {
              alert(e instanceof Error ? e.message : '방장 지정 실패');
            }
          }}
          className={`text-xs px-3 py-1.5 rounded-lg ml-1 transition ${
            isSponsor
              ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          {isSponsor ? '🏆 방장' : '방장 지정'}
        </button>
      </td>
    </tr>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUserDetail[]>([]);
  const [tokens, setTokens] = useState<AdminTokenDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // 추천(방장) 통계
  const [referralStats, setReferralStats] = useState<ReferralStat[]>([]);
  const [referralLoading, setReferralLoading] = useState(true);
  const [referralError, setReferralError] = useState('');

  // 유저 잔액 상세보기
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<AdminWalletDetail[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(false);

  const [pageSize, setPageSize] = useState(20);
  const totalPages = Math.ceil(total / pageSize);

  // 선택 삭제
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const fetchUsers = async (p: number, size: number) => {
    setIsLoading(true);
    setError('');
    try {
      const data = await getUsers(p, size);
      setUsers(data.users);
      setTotal(data.total);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : '유저 조회 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelectUser = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === users.length && users.length > 0 ? new Set() : new Set(users.map((u) => u.id)),
    );
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`선택한 ${selectedIds.size}명의 회원을 삭제하시겠습니까?\n관련 지갑/주문/추천 기록도 함께 삭제되며 되돌릴 수 없습니다.`)) {
      return;
    }
    setDeleting(true);
    try {
      await deleteUsers(Array.from(selectedIds));
      await fetchUsers(page, pageSize);
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제 실패');
    } finally {
      setDeleting(false);
    }
  };

  const fetchReferralStats = async () => {
    setReferralLoading(true);
    setReferralError('');
    try {
      const data = await getReferralStats();
      setReferralStats(data);
    } catch (err) {
      setReferralError(err instanceof Error ? err.message : '방장 실적 조회 실패');
    } finally {
      setReferralLoading(false);
    }
  };

  useEffect(() => {
    getTokens().then((res) => {
      const activeTokens = res.filter(t => t.isActive);
      setTokens(activeTokens);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchUsers(page, pageSize);
    fetchReferralStats();
  }, [page, pageSize]);

  const handleToggleSponsor = async (_userId: string) => {
    // 방장 통계 새로고침
    fetchReferralStats();
  };

  const handleSetSponsor = async (userId: string, telegramUid: number) => {
    await setUserSponsor(userId, telegramUid);
    // 목록/방장 통계 새로고침
    await fetchUsers(page, pageSize);
    fetchReferralStats();
  };

  const handleSetNickname = async (userId: string, nickname: string) => {
    await setUserNickname(userId, nickname);
  };

  const handleViewWallets = async (userId: string) => {
    setSelectedUserId(selectedUserId === userId ? null : userId);
    if (selectedUserId === userId) {
      setWallets([]);
      return;
    }
    setWalletsLoading(true);
    try {
      const data = await getUserWallets(userId);
      setWallets(data);
    } catch {
      setWallets([]);
    } finally {
      setWalletsLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">👥 회원 관리</h1>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 mb-6 text-danger text-sm">
          {error}
        </div>
      )}

      {/* 방장(스폰서) 실적 리더보드 */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 mb-6">
        <div className="p-6 pb-0 flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">🏆 방장 실적</h2>
          <span className="text-sm text-gray-400">어드민 지정 방장</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-center py-3 px-6 text-gray-400 font-medium w-16">순위</th>
                <th className="text-left py-3 px-6 text-gray-400 font-medium">방장(추천코드)</th>
                <th className="text-center py-3 px-6 text-gray-400 font-medium">1대 추천</th>
                <th className="text-center py-3 px-6 text-gray-400 font-medium">총 추천(하위 전체)</th>
                <th className="text-center py-3 px-6 text-gray-400 font-medium">7일 신규</th>
                <th className="text-center py-3 px-6 text-gray-400 font-medium">방장 해제</th>
              </tr>
            </thead>
            <tbody>
              {referralError ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-danger text-sm">{referralError}</td>
                </tr>
              ) : referralLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">로딩 중...</td>
                </tr>
              ) : referralStats.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">지정된 방장이 없습니다. 유저 목록에서 방장을 지정하세요.</td>
                </tr>
              ) : (
                referralStats.map((stat, idx) => (
                  <tr key={stat.referrerId} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                    <td className="py-3 px-6 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                        idx === 0
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : idx === 1
                            ? 'bg-gray-400/20 text-gray-300'
                            : idx === 2
                              ? 'bg-orange-700/30 text-orange-400'
                              : 'bg-gray-700 text-gray-400'
                      }`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="py-3 px-6 font-medium">
                      {stat.referrerName || '—'}
                    </td>
                    <td className="py-3 px-6 text-center">
                      <span className="text-blue-400 font-bold">{stat.directCount}</span>
                      <span className="text-gray-400 text-xs">명</span>
                    </td>
                    <td className="py-3 px-6 text-center">
                      <span className="text-primary-400 font-bold">{stat.totalCount}</span>
                      <span className="text-gray-400 text-xs">명</span>
                    </td>
                    <td className="py-3 px-6 text-center">
                      <span className="text-success font-bold">{stat.weeklyCount}</span>
                      <span className="text-gray-400 text-xs">명</span>
                    </td>
                    <td className="py-3 px-6 text-center">
                      <button
                        onClick={async () => {
                          try {
                            await toggleSponsor(stat.referrerId);
                            fetchReferralStats();
                          } catch (e) {
                            alert(e instanceof Error ? e.message : '방장 해제 실패');
                          }
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition"
                      >
                        해제
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Balance List */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50">
        <div className="p-6 pb-0 flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">💰 유저 목록</h2>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">총 {total}명</span>
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 disabled:opacity-50 transition"
              >
                {deleting ? '삭제 중...' : `🗑 선택 삭제 (${selectedIds.size})`}
              </button>
            )}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="bg-gray-700/50 border border-gray-600 rounded-lg text-sm px-2 py-1 text-gray-200 focus:outline-none focus:border-primary-500"
            >
              <option value={10}>10명씩 보기</option>
              <option value={20}>20명씩 보기</option>
              <option value={50}>50명씩 보기</option>
              <option value={100}>100명씩 보기</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-center py-3 px-4 text-gray-400 font-medium whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={users.length > 0 && selectedIds.size === users.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 accent-primary-600 cursor-pointer"
                  />
                </th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium whitespace-nowrap">가입일</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium whitespace-nowrap">마지막접속일</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium whitespace-nowrap">Tele ID</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium whitespace-nowrap">닉네임</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium whitespace-nowrap">스폰서</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium whitespace-nowrap">추천코드</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium whitespace-nowrap">총추천인원</th>
                <th className="text-center py-3 px-1 w-9 text-gray-400 font-medium whitespace-nowrap">1대</th>
                <th className="text-center py-3 px-1 w-9 text-gray-400 font-medium whitespace-nowrap">2대</th>
                <th className="text-center py-3 px-1 w-9 text-gray-400 font-medium whitespace-nowrap">3대</th>
                <th className="text-center py-3 px-1 w-9 text-gray-400 font-medium whitespace-nowrap">4대</th>
                <th className="text-center py-3 px-1 w-9 text-gray-400 font-medium whitespace-nowrap">5대</th>
                {tokens.map(t => (
                  <th key={t.id} className="text-right py-3 px-4 text-gray-400 font-medium whitespace-nowrap">{t.symbol}</th>
                ))}
                <th className="text-right py-3 px-4 text-gray-400 font-medium whitespace-nowrap">지갑보기</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={14 + tokens.length} className="text-center py-8 text-gray-400">로딩 중...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={14 + tokens.length} className="text-center py-8 text-gray-400">데이터가 없습니다</td>
                </tr>
              ) : (
                users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    tokens={tokens}
                    selectedUserId={selectedUserId}
                    checked={selectedIds.has(user.id)}
                    onToggleCheck={toggleSelectUser}
                    onViewWallets={handleViewWallets}
                    onToggleSponsor={handleToggleSponsor}
                    onSetSponsor={handleSetSponsor}
                    onSetNickname={handleSetNickname}
                  />
                ))
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

      {/* Wallets Detail Panel */}
      {selectedUserId && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 mt-6 p-6">
          <h3 className="text-lg font-bold mb-4">🔗 지갑 상세</h3>
          {walletsLoading ? (
            <p className="text-gray-400 text-sm">로딩 중...</p>
          ) : wallets.length === 0 ? (
            <p className="text-gray-400 text-sm">지갑이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {wallets.map((wallet) => {
                return (
                  <div key={wallet.id} className="bg-gray-900/50 rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400 mb-1">지갑 #{wallet.walletIndex} · {wallet.label}</p>
                      <p className="text-sm font-mono text-gray-300">
                        {wallet.publicKey.slice(0, 12)}...{wallet.publicKey.slice(-6)}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      wallet.isActive
                        ? 'bg-success/20 text-success'
                        : 'bg-gray-700 text-gray-400'
                    }`}>
                      {wallet.isActive ? '활성' : '비활성'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
