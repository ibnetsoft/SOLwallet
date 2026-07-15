import type { Metadata } from 'next';
import './globals.css';
import AdminAppShell from '@/components/AdminAppShell';

export const metadata: Metadata = {
  title: 'DEX MINER BOT — Admin',
  description: '관리자 대시보드',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <AdminAppShell>{children}</AdminAppShell>
      </body>
    </html>
  );
}
