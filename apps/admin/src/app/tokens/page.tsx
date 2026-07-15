'use client';

import { useEffect, useState } from 'react';
import { getTokens, createToken, toggleToken } from '@/lib/api/admin';
import type { AdminTokenDetail } from '@solwallet/shared-types';

export default function TokensPage() {
  const [tokens, setTokens] = useState<AdminTokenDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // 등록 폼
  const [mintAddress, setMintAddress] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState('9');
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchTokens = async () => {
    try {
      const data = await getTokens();
      setTokens(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '토큰 조회 실패');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTokens();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mintAddress.trim() || !symbol.trim()) return;

    setIsCreating(true);
    setFormError('');

    try {
      await createToken({
        mintAddress: mintAddress.trim(),
        symbol: symbol.trim(),
        decimals: Number(decimals) || 9,
      });
      setMintAddress('');
      setSymbol('');
      setDecimals('9');
      fetchTokens();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '토큰 등록 실패');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (tokenId: string) => {
    try {
      await toggleToken(tokenId);
      fetchTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : '상태 변경 실패');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">🪙 토큰 관리</h1>

      {/* Add Token Form */}
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 mb-6">
        <h2 className="text-lg font-bold mb-4">새 토큰 등록</h2>
        <form onSubmit={handleCreate}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">스마트 컨트랙트 (CA)</label>
              <input
                type="text"
                value={mintAddress}
                onChange={(e) => setMintAddress(e.target.value)}
                placeholder="Mint Address"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">심볼</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="예: SOL, USDT, FACT"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">소수점 (Decimals)</label>
              <input
                type="number"
                value={decimals}
                onChange={(e) => setDecimals(e.target.value)}
                placeholder="9"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500 transition"
              />
            </div>
          </div>
          {formError && (
            <p className="text-danger text-sm mt-3">{formError}</p>
          )}
          <button
            type="submit"
            disabled={isCreating || !mintAddress.trim() || !symbol.trim()}
            className="mt-4 bg-primary-600 hover:bg-primary-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
          >
            {isCreating ? '등록 중...' : '토큰 등록'}
          </button>
        </form>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 mb-6 text-danger text-sm">
          {error}
        </div>
      )}

      {/* Token List */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700/50">
        <h2 className="text-lg font-bold p-6 pb-0 mb-4">등록된 토큰</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-6 text-gray-400 font-medium">심볼</th>
                <th className="text-left py-3 px-6 text-gray-400 font-medium">Mint Address</th>
                <th className="text-center py-3 px-6 text-gray-400 font-medium">Decimals</th>
                <th className="text-center py-3 px-6 text-gray-400 font-medium">상태</th>
                <th className="text-right py-3 px-6 text-gray-400 font-medium">관리</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-400">로딩 중...</td>
                </tr>
              ) : tokens.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-400">데이터가 없습니다</td>
                </tr>
              ) : (
                tokens.map((token) => (
                  <tr key={token.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                    <td className="py-3 px-6 font-medium">{token.symbol}</td>
                    <td className="py-3 px-6 text-gray-400 font-mono text-xs">
                      {token.mintAddress.slice(0, 8)}...{token.mintAddress.slice(-4)}
                    </td>
                    <td className="py-3 px-6 text-center">{token.decimals}</td>
                    <td className="py-3 px-6 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        token.isActive
                          ? 'bg-success/20 text-success'
                          : 'bg-gray-700 text-gray-400'
                      }`}>
                        {token.isActive ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-right">
                      <button
                        onClick={() => handleToggle(token.id)}
                        className={`text-xs px-3 py-1.5 rounded-lg transition ${
                          token.isActive
                            ? 'bg-danger/20 text-danger hover:bg-danger/30'
                            : 'bg-success/20 text-success hover:bg-success/30'
                        }`}
                      >
                        {token.isActive ? '비활성화' : '활성화'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
