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
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const botUsername = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'aoiwallet_bot').replace(/^@/, '');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // PWA(Standalone) 모드 감지
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    setIsStandalone(standalone);
    
    // iOS Safari 감지 (공유 -> 홈 화면에 추가 유도용)
    const ua = window.navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    // Android/Chrome PWA 설치 프롬프트 이벤트
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

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
          <div className="flex flex-col gap-4">
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 text-center">
              <p className="text-sm text-gray-300 mb-4">{errorMessage}</p>
              <a
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-xl py-3 px-4 font-medium flex items-center justify-center gap-2 transition"
              >
                Open in Telegram
              </a>
            </div>

            {/* PWA 설치 유도 영역 (Standalone 모드가 아닐 때만 표시) */}
            {!isStandalone && (
              <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 text-center">
                <h3 className="font-semibold text-gray-200 mb-2">Install App</h3>
                {isIOS ? (
                  <div className="text-sm text-gray-400">
                    <p>To install this app on your iPhone:</p>
                    <ol className="list-decimal text-left pl-6 mt-2 space-y-1">
                      <li>Tap the <strong>Share</strong> button at the bottom</li>
                      <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
                    </ol>
                  </div>
                ) : deferredPrompt ? (
                  <div>
                    <p className="text-sm text-gray-400 mb-4">Install AOI Wallet on your device for quick access.</p>
                    <button
                      onClick={handleInstallClick}
                      className="w-full bg-gray-700 hover:bg-gray-600 text-white rounded-xl py-3 px-4 font-medium transition"
                    >
                      Add to Home Screen
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    You can add this website to your Home Screen from your browser menu.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}