'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { devLogin, isLoggedIn } from '@/lib/api/auth';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n';

export default function DevLoginPage() {
  const { t } = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [username, setUsername] = useState('');
  const [telegramUid, setTelegramUid] = useState('');
  const [devSecret, setDevSecret] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // 개발용 로그인
  const handleDevLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const uid = telegramUid.trim() ? Number(telegramUid.trim()) : undefined;
      const token = await devLogin(
        username.trim() || 'dev_user',
        devSecret.trim(),
        uid,
      );
      if (token && isLoggedIn()) {
        showToast(t('login.success'));
        setTimeout(() => router.replace('/'), 500);
      } else {
        showToast(t('login.tokenSaveFailed'));
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('login.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gray-900">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-xl flex items-center justify-center bg-gray-900 mx-auto">
            <img src="/icons/icon-192x192.png" alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-bold">Dev Login</h1>
        </div>

        <form onSubmit={handleDevLogin} className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <h2 className="text-lg font-bold mb-4">{t('login.devTitle')}</h2>

          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('login.usernamePlaceholder')}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-primary-500 transition mb-4"
          />

          <input
            type="text"
            value={telegramUid}
            onChange={(e) => setTelegramUid(e.target.value)}
            placeholder="Telegram UID (특정 계정 로그인용, 예: 338505911)"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-primary-500 transition mb-4 font-mono text-sm"
          />

          <input
            type="password"
            value={devSecret}
            onChange={(e) => setDevSecret(e.target.value)}
            placeholder={t('login.devSecretPlaceholder')}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-primary-500 transition mb-4"
          />

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-4 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-bold text-lg transition disabled:opacity-50"
          >
            {isLoading ? t('login.processing') : t('login.devSubmit')}
          </button>
        </form>
      </div>
    </main>
  );
}
