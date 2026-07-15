import type { Metadata } from 'next';
import './globals.css';

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        MainButton: {
          text: string;
          show: () => void;
          hide: () => void;
          onClick: (fn: () => void) => void;
        };
        BackButton: {
          show: () => void;
          hide: () => void;
          onClick: (fn: () => void) => void;
        };
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          };
          start_param?: string;
        };
        themeParams: Record<string, string>;
      };
    };
  }
}

export const metadata: Metadata = {
  title: 'DEX MINER BOT',
  description: '솔라나 지정가 거래 텔레그램 미니앱',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        {children}
      </body>
    </html>
  );
}
