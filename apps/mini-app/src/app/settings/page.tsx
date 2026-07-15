'use client';

import Link from 'next/link';

export default function SettingsPage() {
  return (
    <main className="min-h-screen p-4 pb-24">
      {/* Header */}
      <header className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-xl">←</Link>
        <h1 className="text-xl font-bold">⚙️ 설정</h1>
      </header>

      {/* Wallet Management */}
      <section className="mb-6">
        <h2 className="text-sm text-gray-400 mb-2">지갑 관리</h2>
        <div className="space-y-2">
          <button className="w-full bg-gray-800/50 rounded-xl p-4 text-left flex items-center justify-between">
            <div>
              <p className="font-medium">🆕 새 지갑 생성</p>
              <p className="text-xs text-gray-400">새 솔라나 지갑을 만듭니다</p>
            </div>
            <span className="text-gray-500">→</span>
          </button>
          <button className="w-full bg-gray-800/50 rounded-xl p-4 text-left flex items-center justify-between">
            <div>
              <p className="font-medium">📥 시드구문 Import</p>
              <p className="text-xs text-gray-400">기존 지갑을 가져옵니다</p>
            </div>
            <span className="text-gray-500">→</span>
          </button>
        </div>
      </section>

      {/* Wallet List */}
      <section className="mb-6">
        <h2 className="text-sm text-gray-400 mb-2">내 지갑 목록</h2>
        <div className="space-y-2">
          <div className="bg-gray-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-medium">지갑 1</p>
              <p className="text-xs text-gray-400 font-mono">—</p>
            </div>
            <span className="text-xs bg-primary-600 px-2 py-0.5 rounded">활성</span>
          </div>
          <p className="text-xs text-gray-500 text-center py-2">
            최대 3개의 지갑을 관리할 수 있습니다
          </p>
        </div>
      </section>

      {/* App Info */}
      <section className="mb-6">
        <h2 className="text-sm text-gray-400 mb-2">앱 정보</h2>
        <div className="bg-gray-800/50 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">버전</span>
            <span>v0.1.0</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">네트워크</span>
            <span>Devnet</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">DEX</span>
            <span>Manifest.trade</span>
          </div>
        </div>
      </section>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800">
        <div className="flex justify-around py-2">
          <Link href="/" className="flex flex-col items-center text-gray-500 py-1">
            <span className="text-lg">🏠</span>
            <span className="text-xs">홈</span>
          </Link>
          <Link href="/trade" className="flex flex-col items-center text-gray-500 py-1">
            <span className="text-lg">📊</span>
            <span className="text-xs">거래</span>
          </Link>
          <Link href="/settings" className="flex flex-col items-center text-primary-500 py-1">
            <span className="text-lg">⚙️</span>
            <span className="text-xs">설정</span>
          </Link>
        </div>
      </nav>
    </main>
  );
}
