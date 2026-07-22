'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { devLogin, telegramLogin, isLoggedIn } from '@/lib/api/auth';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n';

export default function LoginPage() {
  const { t } = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'checking' | 'telegram' | 'dev'>('checking');

  // 초기 확인 — Telegram 환경인지, 이미 로그인되었는지
  useEffect(() => {
    const init = async () => {
      // 1. 이미 로그인되어 있으면 홈으로
      if (isLoggedIn()) {
        router.replace('/');
        return;
      }

      // 2. 추천인 코드 추출 — Telegram start_param 우선, URL ?ref= 폴백
      const extractReferralCode = (): string | undefined => {
        // Telegram 미니앱 딥링크 ?startapp=<code>
        const startParam = (window as any).Telegram?.WebApp?.initDataUnsafe?.start_param;
        if (startParam && startParam.length >= 4) {
          return startParam;
        }
        // 일반 웹 URL ?ref=<code>
        const urlRef = new URLSearchParams(window.location.search).get('ref');
        if (urlRef && urlRef.length >= 4) {
          return urlRef;
        }
        return undefined;
      };

      // 3. Telegram WebApp 환경 확인 (SDK 로드 대기)
      const checkTelegram = () => {
        if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
          const tg = (window as any).Telegram.WebApp;
          tg.ready();
          tg.expand();
          const initData = tg.initData;
          if (initData && initData.length > 10) {
            setStatus('telegram');
            // 자동 로그인 — 추천인 코드 함께 전달
            const referralCode = extractReferralCode();
            telegramLogin(initData, referralCode)
              .then(() => {
                showToast(t('login.telegramSuccess'));
                // localStorage 저장 확인 후 이동
                setTimeout(() => router.replace('/'), 300);
              })
              .catch((err) => {
                setStatus('dev');
                showToast(err instanceof Error ? err.message : t('login.telegramFailed'));
              });
            return true;
          }
        }
        return false;
      };

      // SDK가 늦게 로드될 수 있으므로 잠시 대기
      if (!checkTelegram()) {
        setTimeout(() => {
          if (!checkTelegram()) {
            setStatus('dev');
          }
        }, 500);
      }
    };

    init();
  }, [router, showToast, t]);

  // 개발용 로그인
  const handleDevLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const token = await devLogin(username.trim() || 'dev_user');
      // 토큰 저장 확인
      if (token && isLoggedIn()) {
        showToast(t('login.success'));
        // 약간 대기 후 이동 (localStorage 동기화 보장)
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
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">🔥 DEX MINER</h1>
          <p className="text-sm text-gray-400">{t('login.subtitle')}</p>
        </div>

        {/* 체크 중 */}
        {status === 'checking' && (
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 text-center">
            <p className="text-sm text-gray-400">{t('login.checking')}</p>
          </div>
        )}

        {/* Telegram 자동 로그인 중 */}
        {status === 'telegram' && (
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 text-center">
            <p className="text-sm text-gray-400">{t('login.telegramAuth')}</p>
          </div>
        )}

        {/* 개발용 로그인 폼 */}
        {status === 'dev' && (
          <>
            <form onSubmit={handleDevLogin} className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
              <h2 className="text-lg font-bold mb-1">{t('login.devTitle')}</h2>
              <p className="text-xs text-gray-400 mb-4">
                {t('login.devDesc')}
              </p>

              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('login.usernamePlaceholder')}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-primary-500 transition mb-4"
              />

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-lg font-medium transition disabled:opacity-50"
              >
                {isLoading ? t('login.loggingIn') : t('login.loginBtn')}
              </button>
            </form>

            <button
              onClick={() => {
                localStorage.clear();
                showToast(t('login.cacheCleared'));
                setStatus('dev');
              }}
              className="w-full mt-3 text-xs text-gray-500 hover:text-gray-400 py-2"
            >
              {t('login.clearCache')}
            </button>
          </>
        )}
      </div>
    </main>
  );
}