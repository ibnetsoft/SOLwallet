'use client';

import { useEffect, useState } from 'react';
import { getFeeRate, updateFeeRate } from '@/lib/api/admin';

export default function SettingsPage() {
  const [feeRate, setFeeRate] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    loadFeeRate();
  }, []);

  const loadFeeRate = async () => {
    setIsLoading(true);
    try {
      const data = await getFeeRate();
      setFeeRate(data.feeRate);
      setInputValue(String((data.feeRate * 100).toFixed(2)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '조회 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccessMsg('');

    const percent = Number(inputValue);
    if (!Number.isFinite(percent) || percent < 0 || percent > 50) {
      setError('수수료율은 0~50% 범위여야 합니다.');
      return;
    }

    setIsSaving(true);
    try {
      const rate = percent / 100;
      const result = await updateFeeRate(rate);
      setFeeRate(result.feeRate);
      setInputValue(String((result.feeRate * 100).toFixed(2)));
      setSuccessMsg('수수료율이 저장되었습니다.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">⚙️ 설정</h1>

      {/* 수수료율 설정 */}
      <div className="bg-gray-800 rounded-xl p-6 max-w-md">
        <h2 className="text-lg font-semibold mb-2">거래 수수료율</h2>
        <p className="text-sm text-gray-400 mb-4">
          사용자 거래 시 부과되는 수수료율입니다. (0~50%)
        </p>

        {isLoading ? (
          <p className="text-gray-400">불러오는 중...</p>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="number"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                min="0"
                max="50"
                step="0.01"
                disabled={isSaving}
                className="w-32 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white outline-none focus:border-primary-500 disabled:opacity-50"
              />
              <span className="text-gray-400">%</span>
            </div>

            {feeRate !== null && (
              <p className="text-xs text-gray-500 mb-4">
                현재 적용값: {feeRate * 100}% (소수: {feeRate})
              </p>
            )}

            {error && (
              <p className="text-sm text-red-400 mb-3">{error}</p>
            )}
            {successMsg && (
              <p className="text-sm text-green-400 mb-3">{successMsg}</p>
            )}

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-2.5 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 transition disabled:opacity-50"
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
