'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { devLogin, telegramLogin, isLoggedIn } from '@/lib/api/auth';
import { useToast } from '@/components/Toast';

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [telegramData, setTelegramData] = useState<string | null>(null);

  // 이미 로그인되어 있으면 홈으로
  useEffect(() => {
    if (isLoggedIn()) {
      router.replace('/');
    }

    // Telegram WebApp 환경인지 확인
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      const initData = tg.initData;
      if (initData) {
        setTelegramData(initData);
        // 자동 로그인 시도
        telegramLogin(initData)
          .then(() => router.replace('/'))
          .catch(() => {});
      }
    }
  }, [router]);

  // 개발용 로그인
  const handleDevLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await devLogin(username.trim() || 'dev_user');
      showToast('✅ 로그인되었습니다.');
      router.replace('/');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '로그인 실패');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">🔥 DEX MINER</h1>
          <p className="text-sm text-gray-400">솔라나 지정가 거래</p>
        </div>

        {/* Telegram 자동 로그인 중 */}
        {telegramData && (
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 text-center">
            <p className="text-sm text-gray-400">Telegram 인증 중...</p>
          </div>
        )}

        {/* 개발용 로그인 (Telegram 환경이 아닐 때) */}
        {!telegramData && (
          <>
            <form onSubmit={handleDevLogin} className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
              <h2 className="text-lg font-bold mb-1">로그인</h2>
              <p className="text-xs text-gray-400 mb-4">
                개발 모드 — Telegram 없이 테스트 계정으로 로그인
              </p>

              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="사용자명 (선택)"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-primary-500 transition mb-4"
              />

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-lg font-medium transition disabled:opacity-50"
              >
                {isLoading ? '로그인 중...' : '개발용 로그인'}
              </button>
            </form>

            <div className="mt-4 bg-yellow-900/20 border border-yellow-800/40 rounded-xl p-3">
              <p className="text-xs text-yellow-400 text-center">
                ⚠️ 프로덕션에서는 Telegram WebApp을 통해서만 접근 가능합니다.
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
