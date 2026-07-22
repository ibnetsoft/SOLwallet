'use client';

import { useState, useEffect, useCallback } from 'react';
import { getReferralTree, getReferralRoots } from '@/lib/api/admin';
import type { ReferralTreeNode, ReferralAncestor, ReferralRoot, ReferralTreeResponse } from '@solwallet/shared-types';

// ─── 레벨별 색상 ───
const LEVEL_COLORS = [
  'bg-yellow-500/20 text-yellow-400',
  'bg-blue-500/20 text-blue-400',
  'bg-green-500/20 text-green-400',
  'bg-purple-500/20 text-purple-400',
  'bg-orange-500/20 text-orange-400',
  'bg-pink-500/20 text-pink-400',
];

const LEVEL_BORDER = [
  'border-l-yellow-500',
  'border-l-blue-500',
  'border-l-green-500',
  'border-l-purple-500',
  'border-l-orange-500',
  'border-l-pink-500',
];

// ─── 트리 노드 컴포넌트 ───
function TreeNode({
  node,
  onNavigate,
  depth = 0,
}: {
  node: ReferralTreeNode;
  onNavigate: (userId: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;

  return (
    <div className={depth > 0 ? 'ml-6 border-l-2 ' + (LEVEL_BORDER[depth % LEVEL_BORDER.length] || 'border-l-gray-600') : ''}>
      <div
        className={`flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-gray-700/40 transition cursor-pointer group ${
          depth === 0 ? 'bg-gray-800/80 border border-gray-700/50' : ''
        }`}
        onClick={() => onNavigate(node.id)}
      >
        {/* 확장/접기 */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white text-xs"
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-5 h-5 flex items-center justify-center text-gray-600 text-xs">●</span>
        )}

        {/* 레벨 뱃지 */}
        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${LEVEL_COLORS[depth % LEVEL_COLORS.length]}`}>
          LV.{depth}
        </span>

        {/* 유저 정보 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">
              {node.username || node.firstName || '—'}
            </span>
            <span className="text-gray-500 text-xs font-mono">
              {node.telegramUid}
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {node.referralCode && (
              <span className="text-primary-400 mr-3">{node.referralCode}</span>
            )}
            <span>{new Date(node.createdAt).toLocaleDateString('ko-KR')}</span>
          </div>
        </div>

        {/* 하위 수 */}
        <div className="text-right">
          {hasChildren && (
            <span className="text-xs text-gray-400">
              <span className="text-primary-400 font-bold">{node.childrenCount}</span>명
            </span>
          )}
        </div>
      </div>

      {/* 자식 노드 */}
      {expanded && hasChildren && (
        <div className="mt-0.5">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} onNavigate={onNavigate} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 메인 페이지 ───
export default function ReferralTreePage() {
  const [roots, setRoots] = useState<ReferralRoot[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<ReferralTreeResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [maxDepth, setMaxDepth] = useState(5);
  const [isLoading, setIsLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [error, setError] = useState('');

  // 루트 목록 로드
  const fetchRoots = useCallback(async () => {
    try {
      const data = await getReferralRoots();
      setRoots(data as ReferralRoot[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '루트 조회 실패');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoots();
  }, [fetchRoots]);

  // 트리 로드
  const loadTree = async (userId: string, depth?: number) => {
    setTreeLoading(true);
    setError('');
    setSelectedUserId(userId);
    try {
      const data = await getReferralTree(userId, depth ?? maxDepth);
      setTreeData(data as ReferralTreeResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : '트리 조회 실패');
    } finally {
      setTreeLoading(false);
    }
  };

  // 검색 (username 또는 referral_code)
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setTreeLoading(true);
    setError('');
    try {
      // 루트 목록에서 검색
      const q = searchQuery.trim().toLowerCase();
      const found = (roots as ReferralRoot[]).find(
        (r) =>
          (r.username || '').toLowerCase() === q ||
          (r.referralCode || '').toLowerCase() === q ||
          String(r.telegramUid) === q,
      );
      if (found) {
        await loadTree(found.id);
      } else {
        // 루트가 아니면 직접 userId로 시도 (referral_code인 경우)
        const rootWithCode = (roots as ReferralRoot[]).find(
          (r) => (r.referralCode || '').toLowerCase() === q,
        );
        if (rootWithCode) {
          await loadTree(rootWithCode.id);
        } else {
          setError('해당 유저를 찾을 수 없습니다.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '검색 실패');
    } finally {
      setTreeLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">🌳 추천 조직도</h1>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 mb-6 text-danger text-sm">
          {error}
        </div>
      )}

      {/* 검색바 + 깊이 설정 */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-4 mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="username, referral_code, 또는 Telegram UID 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500"
          />
          <button
            onClick={handleSearch}
            disabled={!searchQuery.trim() || treeLoading}
            className="px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition"
          >
            검색
          </button>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <span className="text-xs text-gray-400">최대 깊이:</span>
          {[3, 5, 7, 10].map((d) => (
            <button
              key={d}
              onClick={() => {
                setMaxDepth(d);
                if (selectedUserId) loadTree(selectedUserId, d);
              }}
              className={`text-xs px-3 py-1 rounded-full transition ${
                maxDepth === d
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {d}단계
            </button>
          ))}
        </div>
      </div>

      {/* 트리가 로드된 경우 */}
      {treeData && treeData.tree && (
        <>
          {/* Ancestor breadcrumbs */}
          {treeData.ancestors.length > 0 && (
            <div className="flex items-center gap-1 mb-4 flex-wrap">
              <span className="text-xs text-gray-500">경로:</span>
              {treeData.ancestors
                .slice()
                .reverse()
                .map((a: ReferralAncestor, i: number) => (
                  <span key={a.id} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-600">→</span>}
                    <button
                      onClick={() => loadTree(a.id)}
                      className="text-xs text-primary-400 hover:text-primary-300 hover:underline"
                    >
                      {a.username || a.firstName || '—'}
                    </button>
                  </span>
                ))}
              <span className="text-gray-600">→</span>
              <span className="text-xs font-bold text-white">
                {treeData.tree.username || treeData.tree.firstName || '—'}
              </span>
            </div>
          )}

          {/* 통계 카드 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
              <p className="text-xs text-gray-400 mb-1">총 조직원</p>
              <p className="text-xl font-bold text-blue-400">{treeData.stats.totalNodes}</p>
            </div>
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
              <p className="text-xs text-gray-400 mb-1">최대 깊이</p>
              <p className="text-xl font-bold text-green-400">{treeData.stats.maxDepth}단계</p>
            </div>
            {/* 레벨별 분포 */}
            {Object.entries(treeData.stats.perLevelCounts).map(([level, count]) => (
              <div key={level} className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <p className="text-xs text-gray-400 mb-1">LV.{level}</p>
                <p className={`text-xl font-bold ${LEVEL_COLORS[Number(level) % LEVEL_COLORS.length].split(' ')[1]}`}>
                  {count as number}명
                </p>
              </div>
            ))}
          </div>

          {/* 트리 뷰 */}
          {treeLoading ? (
            <div className="text-center py-8 text-gray-400">로딩 중...</div>
          ) : (
            <div className="bg-gray-800/30 rounded-xl border border-gray-700/50 p-4">
              <TreeNode node={treeData.tree} onNavigate={loadTree} />
            </div>
          )}
        </>
      )}

      {/* 초기 화면: 루트 목록 */}
      {!treeData && !treeLoading && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700/50">
          <div className="p-6 pb-0 flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">🏆 최상위 추천인</h2>
            <span className="text-sm text-gray-400">총 {roots.length}명</span>
          </div>
          {isLoading ? (
            <div className="text-center py-8 text-gray-400">로딩 중...</div>
          ) : roots.length === 0 ? (
            <div className="text-center py-8 text-gray-400">데이터가 없습니다</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-6 text-gray-400 font-medium">이름</th>
                    <th className="text-left py-3 px-6 text-gray-400 font-medium">Telegram UID</th>
                    <th className="text-left py-3 px-6 text-gray-400 font-medium">추천코드</th>
                    <th className="text-center py-3 px-6 text-gray-400 font-medium">직추천 수</th>
                    <th className="text-center py-3 px-6 text-gray-400 font-medium">가입일</th>
                    <th className="text-center py-3 px-6 text-gray-400 font-medium">조회</th>
                  </tr>
                </thead>
                <tbody>
                  {roots.map((root) => (
                    <tr
                      key={root.id}
                      className="border-b border-gray-700/50 hover:bg-gray-700/30 transition"
                    >
                      <td className="py-3 px-6 font-medium">
                        {root.username || root.firstName || '—'}
                      </td>
                      <td className="py-3 px-6 text-gray-400 font-mono text-xs">
                        {root.telegramUid}
                      </td>
                      <td className="py-3 px-6 text-primary-400 font-mono text-xs">
                        {root.referralCode || '—'}
                      </td>
                      <td className="py-3 px-6 text-center">
                        <span className="text-success font-bold">{root.directCount}</span>
                      </td>
                      <td className="py-3 px-6 text-center text-gray-400 text-xs">
                        {new Date(root.createdAt).toLocaleDateString('ko-KR')}
                      </td>
                      <td className="py-3 px-6 text-center">
                        <button
                          onClick={() => loadTree(root.id)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 transition"
                        >
                          조직도
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
