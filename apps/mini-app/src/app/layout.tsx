import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { I18nProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'DEX MINER BOT',
  description: 'Solana Limit Order Trading Telegram Mini App',
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
    <html lang="en">
      <head>
        {/* Telegram WebApp SDK */}
        <script {...telegramScript} />
      </head>
      <body className="min-h-screen">
        <I18nProvider>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}