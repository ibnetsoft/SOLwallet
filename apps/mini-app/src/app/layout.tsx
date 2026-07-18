import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';

export const metadata: Metadata = {
  title: 'DEX MINER BOT',
  description: '솔라나 지정가 거래 텔레그램 미니앱',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1a1a2e',
};

/**
 * Telegram WebApp SDK 로드 스크립트
 * - Telegram 환경에서 window.Telegram.WebApp 사용 가능
 * - 일반 브라우저에서는 무시됨 (개발용 로그인으로 대체)
 */
const telegramScript = {
  src: 'https://telegram.org/js/telegram-web-app.js',
  async: true,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* Telegram WebApp SDK */}
        <script {...telegramScript} />
      </head>
      <body className="min-h-screen">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
