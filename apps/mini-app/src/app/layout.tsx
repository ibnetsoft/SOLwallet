import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { I18nProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'AOI Wallet',
  description: 'AOI Wallet — Solana Trading Telegram Mini App',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'AOI Wallet',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1a1a2e',
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
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className="min-h-screen">
        <Script id="tg-theme" strategy="afterInteractive">
          {`
            if (window.Telegram && window.Telegram.WebApp) {
              window.Telegram.WebApp.ready();
              window.Telegram.WebApp.setHeaderColor('#1a1a2e');
              window.Telegram.WebApp.setBackgroundColor('#1a1a2e');
            }
          `}
        </Script>
        <I18nProvider>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}