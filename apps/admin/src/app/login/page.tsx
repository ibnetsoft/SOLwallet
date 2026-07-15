'use client';

import { useState } from 'react';
import { adminLogin } from '@/lib/api/auth';

export default function LoginPage() {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;

    setIsLoading(true);
    setError('');

    try {
      await adminLogin(secret.trim());
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">🔥 DEX MINER</h1>
          <p className="text-sm text-gray-400">관리자 대시보드</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
          <h2 className="text-lg font-bold text-center mb-4">관리자 로그인</h2>

          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">Admin Secret</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="관리자 비밀키 입력"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-primary-500 transition"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-danger text-sm mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading || !secret.trim()}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-lg font-medium transition disabled:opacity-50"
          >
            {isLoading ? '인증 중...' : '로그인'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500 mt-4">
          ⚠️ 관리자 전용 페이지입니다. 무단 접근을 금지합니다.
        </p>
      </div>
    </div>
  );
}
