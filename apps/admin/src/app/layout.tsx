import type { Metadata } from 'next';
import './globals.css';
import AdminSidebar from '@/components/AdminSidebar';

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
      <body className="bg-gray-100 min-h-screen">
        <div className="flex min-h-screen">
          <AdminSidebar />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
