'use client';

import { useEffect, useState, useRef } from 'react';
import { getTokens, createToken, toggleToken, deleteToken, uploadTokenLogo } from '@/lib/api/admin';
import type { AdminTokenDetail } from '@solwallet/shared-types';

// Solana base58 mint address (32~44자)
const MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

  // 실시간 검증 에러
  const [mintError, setMintError] = useState('');
  const [decimalsError, setDecimalsError] = useState('');

  const validateMint = (value: string): boolean => {
    if (!value) {
      setMintError('');
      return false;
    }
    if (!MINT_REGEX.test(value)) {
      setMintError('올바른 Solana mint address(base58, 32~44자)가 아닙니다.');
      return false;
    }
    setMintError('');
    return true;
  };

  const validateDecimals = (value: string): boolean => {
    if (value === '') {
      setDecimalsError('');
      return false;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 9) {
      setDecimalsError('소수점 자리는 0~9 사이여야 합니다.');
      return false;
    }
    setDecimalsError('');
    return true;
  };

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

    // 제출 전 최종 검증
    const mintOk = validateMint(mintAddress.trim());
    const decimalsOk = validateDecimals(decimals.trim());
    if (!mintOk || !decimalsOk) return;

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
      setMintError('');
      setDecimalsError('');
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

  const handleDelete = async (tokenId: string, symbol: string) => {
    if (typeof window !== 'undefined') {
      if (!window.confirm(`'${symbol}' 토큰을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
        return;
      }
    }
    try {
      await deleteToken(tokenId);
      fetchTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : '토큰 삭제 실패');
    }
  };

  // 행별 업로드 진행 상태
  const [uploadingSymbol, setUploadingSymbol] = useState<string | null>(null);

  const handleLogoUpload = async (symbol: string, file: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('파일 크기는 2MB 이하여야 합니다.');
      return;
    }
    setUploadingSymbol(symbol);
    setError('');
    try {
      await uploadTokenLogo(symbol, file);
      fetchTokens(); // 새 URL(refresh)로 갱신
    } catch (err) {
      setError(err instanceof Error ? err.message : '로고 업로드 실패');
    } finally {
      setUploadingSymbol(null);
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
                onChange={(e) => {
                  setMintAddress(e.target.value);
                  validateMint(e.target.value.trim());
                }}
                onBlur={() => validateMint(mintAddress.trim())}
                placeholder="Mint Address"
                className={`w-full bg-gray-900 border rounded-lg px-3 py-2 text-sm text-white outline-none transition ${
                  mintError
                    ? 'border-danger focus:border-danger'
                    : 'border-gray-700 focus:border-primary-500'
                }`}
              />
              {mintError && (
                <p className="text-danger text-xs mt-1">{mintError}</p>
              )}
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
              <label className="block text-sm text-gray-400 mb-1">소수점 (Decimals, 0~9)</label>
              <input
                type="number"
                min={0}
                max={9}
                step={1}
                value={decimals}
                onChange={(e) => {
                  setDecimals(e.target.value);
                  validateDecimals(e.target.value);
                }}
                placeholder="9"
                className={`w-full bg-gray-900 border rounded-lg px-3 py-2 text-sm text-white outline-none transition ${
                  decimalsError
                    ? 'border-danger focus:border-danger'
                    : 'border-gray-700 focus:border-primary-500'
                }`}
              />
              {decimalsError && (
                <p className="text-danger text-xs mt-1">{decimalsError}</p>
              )}
            </div>
          </div>
          {formError && (
            <p className="text-danger text-sm mt-3">{formError}</p>
          )}
          <button
            type="submit"
            disabled={
              isCreating ||
              !mintAddress.trim() ||
              !symbol.trim() ||
              Boolean(mintError) ||
              Boolean(decimalsError)
            }
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
                <th className="text-center py-3 px-6 text-gray-400 font-medium">로고</th>
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
                  <td colSpan={6} className="text-center py-8 text-gray-400">로딩 중...</td>
                </tr>
              ) : tokens.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">데이터가 없습니다</td>
                </tr>
              ) : (
                tokens.map((token) => (
                  <tr key={token.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                    <td className="py-3 px-6">
                      <LogoCell
                        symbol={token.symbol}
                        logoUrl={token.logoUrl}
                        isUploading={uploadingSymbol === token.symbol}
                        onUpload={(file) => handleLogoUpload(token.symbol, file)}
                      />
                    </td>
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
                      <div className="flex items-center justify-end gap-2">
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
                        <button
                          onClick={() => handleDelete(token.id, token.symbol)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-gray-700/50 text-gray-300 hover:bg-danger/30 hover:text-danger transition"
                          title="토큰 삭제"
                        >
                          삭제
                        </button>
                      </div>
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

// ===== 토큰 로고 셀 — 미리보기 + 업로드 버튼 =====
function LogoCell({
  symbol,
  logoUrl,
  isUploading,
  onUpload,
}: {
  symbol: string;
  logoUrl?: string | null;
  isUploading: boolean;
  onUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center justify-center gap-2">
      {/* 로고 미리보기 — 32x32 */}
      <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-700 flex items-center justify-center shrink-0">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={symbol}
            className="w-full h-full object-cover"
            onError={(e) => {
              // 이미지 로드 실패 시 fallback (첫 글자)
              const target = e.currentTarget;
              target.style.display = 'none';
              const parent = target.parentElement;
              if (parent) parent.textContent = symbol.charAt(0).toUpperCase();
            }}
          />
        ) : (
          <span className="text-xs font-bold text-gray-300">
            {symbol.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* 업로드 버튼 (숨겨진 input) */}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          // 같은 파일 재선택 가능하도록 초기화
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
        className="text-xs px-2 py-1 rounded-lg bg-primary-600/20 text-primary-400 hover:bg-primary-600/40 transition disabled:opacity-50"
        title="PNG 로고 업로드"
      >
        {isUploading ? '...' : '업로드'}
      </button>
    </div>
  );
}
