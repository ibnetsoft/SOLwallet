import type { Metadata } from 'next';
import './globals.css';

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
