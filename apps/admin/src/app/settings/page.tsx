'use client';

import { useEffect, useState } from 'react';
import { getFeeRate, updateFeeRate, getSubAdmins, createSubAdmin, deleteSubAdmin, type SubAdmin } from '@/lib/api/admin';
import { getAdminRole } from '@/lib/api/auth';

export default function SettingsPage() {
  const [feeRate, setFeeRate] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 서브어드민 관련
  const [role, setRole] = useState<string | null>(null);
  const [subAdmins, setSubAdmins] = useState<SubAdmin[]>([]);
  const [subAdminLoading, setSubAdminLoading] = useState(false);
  const [subAdminError, setSubAdminError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    setRole(getAdminRole());
    loadFeeRate();
  }, []);

  useEffect(() => {
    if (role === 'superadmin') {
      loadSubAdmins();
    }
  }, [role]);

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

  const loadSubAdmins = async () => {
    setSubAdminLoading(true);
    setSubAdminError('');
    try {
      const data = await getSubAdmins();
      setSubAdmins(data);
    } catch (err) {
      setSubAdminError(err instanceof Error ? err.message : '목록 조회 실패');
    } finally {
      setSubAdminLoading(false);
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

  const handleCreateSubAdmin = async () => {
    if (!newUsername.trim() || !newPassword.trim()) return;
    setIsCreating(true);
    setSubAdminError('');
    try {
      await createSubAdmin(newUsername.trim(), newPassword.trim());
      setNewUsername('');
      setNewPassword('');
      await loadSubAdmins();
    } catch (err) {
      setSubAdminError(err instanceof Error ? err.message : '생성 실패');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteSubAdmin = async (id: string, username: string) => {
    if (!window.confirm(`'${username}' 서브어드민을 삭제하시겠습니까?`)) return;
    try {
      await deleteSubAdmin(id);
      await loadSubAdmins();
    } catch (err) {
      setSubAdminError(err instanceof Error ? err.message : '삭제 실패');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">⚙️ 설정</h1>

      {/* 수수료율 설정 */}
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 max-w-lg mb-8">
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

      {/* 서브어드민 관리 — 슈퍼어드민만 노출 */}
      {role === 'superadmin' && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 max-w-2xl">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-bold mb-1">👤 서브어드민 관리</h2>
            <p className="text-sm text-gray-400 mb-5">
              서브어드민을 생성하면 해당 아이디/비밀번호로 어드민 페이지에 로그인할 수 있습니다.
            </p>

            {/* 생성 폼 */}
            <div className="flex items-end gap-3 mb-6 flex-wrap">
              <div>
                <label className="block text-xs text-gray-400 mb-1">아이디</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="서브어드민 아이디"
                  className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500 transition"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">비밀번호</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="비밀번호"
                  className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500 transition"
                />
              </div>
              <button
                onClick={handleCreateSubAdmin}
                disabled={isCreating || !newUsername.trim() || !newPassword.trim()}
                className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition disabled:opacity-50"
              >
                {isCreating ? '생성 중...' : '+ 생성'}
              </button>
            </div>

            {subAdminError && (
              <p className="text-sm text-danger mb-4">{subAdminError}</p>
            )}
          </div>

          {/* 목록 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-6 text-gray-400 font-medium">아이디</th>
                  <th className="text-left py-3 px-6 text-gray-400 font-medium">생성일</th>
                  <th className="text-right py-3 px-6 text-gray-400 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {subAdminLoading ? (
                  <tr>
                    <td colSpan={3} className="text-center py-8 text-gray-400">로딩 중...</td>
                  </tr>
                ) : subAdmins.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center py-8 text-gray-400">등록된 서브어드민이 없습니다</td>
                  </tr>
                ) : (
                  subAdmins.map((sa) => (
                    <tr key={sa.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                      <td className="py-3 px-6 font-medium">{sa.username}</td>
                      <td className="py-3 px-6 text-gray-400 text-xs">
                        {new Date(sa.created_at).toLocaleString('ko-KR')}
                      </td>
                      <td className="py-3 px-6 text-right">
                        <button
                          onClick={() => handleDeleteSubAdmin(sa.id, sa.username)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-danger/20 text-danger hover:bg-danger/30 transition"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

