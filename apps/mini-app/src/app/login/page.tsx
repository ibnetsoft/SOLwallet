'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { telegramLogin, isLoggedIn } from '@/lib/api/auth';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n';

export default function LoginPage() {
  const { t } = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [status, setStatus] = useState<'checking' | 'telegram' | 'error'>('checking');
  const [errorMessage, setErrorMessage] = useState('');

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
                setStatus('error');
                setErrorMessage(err instanceof Error ? err.message : t('login.telegramFailed'));
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
            setStatus('error');
            setErrorMessage('Please open this app inside Telegram.');
          }
        }, 500);
      }
    };

    init();
  }, [router, showToast, t]);

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-xl flex items-center justify-center bg-gray-900 mx-auto">
            <img src="/icons/icon-192x192.png" alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-bold">AOI Wallet</h1>
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

        {/* 에러 발생 (Telegram 환경 아님 혹은 인증 실패) */}
        {status === 'error' && (
          <div className="bg-gray-800/50 rounded-xl p-6 border border-red-500/30 text-center">
            <p className="text-sm text-red-400 mb-2">{errorMessage}</p>
          </div>
        )}
      </div>
    </main>
  );
}