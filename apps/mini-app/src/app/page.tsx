'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function HomePage() {
  useEffect(() => {
    // Initialize Telegram WebApp SDK
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
  }, []);

  return (
    <main className="min-h-screen p-4 pb-24">
      {/* Header — Wallet Area */}
      <header className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold">DEX MINER BOT</h1>
            <p className="text-sm text-gray-400">지정가 거래 전용</p>
          </div>
          <Link href="/settings" className="text-2xl">⚙️</Link>
        </div>

        {/* Wallet Address */}
        <div className="bg-gray-800/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">내 지갑</p>
          <div className="flex items-center justify-between">
            <p className="text-sm font-mono truncate">
              지갑을 생성해주세요
            </p>
            <button className="text-xs bg-gray-700 px-2 py-1 rounded">
              복사
            </button>
          </div>
        </div>
      </header>

      {/* Total Balance */}
      <section className="bg-gray-800/50 rounded-xl p-4 mb-6">
        <p className="text-xs text-gray-400 mb-1">전체 자산 (USDT)</p>
        <p className="text-3xl font-bold">$0.00</p>
        <div className="flex gap-4 mt-2">
          <span className="text-sm text-gray-400">ROI: 0%</span>
          <span className="text-sm text-gray-400">P&L: $0.00</span>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex gap-2 mt-4">
          <button className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium">
            입금
          </button>
          <button className="flex-1 bg-gray-700 text-white py-2 rounded-lg text-sm font-medium">
            출금
          </button>
          <button className="flex-1 bg-gray-700 text-white py-2 rounded-lg text-sm font-medium">
            지갑관리
          </button>
        </div>
      </section>

      {/* Trading Banner */}
      <section className="mb-6">
        <div className="bg-gradient-to-r from-primary-600 to-primary-800 rounded-xl p-4 text-center">
          <p className="text-sm text-primary-200 mb-3">🚀 토큰 거래하러 가기</p>
          <div className="flex gap-2 justify-center">
            <Link
              href="/trade?type=buy"
              className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-bold transition"
            >
              📈 BUY
            </Link>
            <Link
              href="/trade?type=sell"
              className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-bold transition"
            >
              📉 SELL
            </Link>
          </div>
        </div>
      </section>

      {/* Holdings */}
      <section>
        <h2 className="text-lg font-bold mb-3">보유 자산</h2>
        <div className="space-y-2">
          <div className="bg-gray-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-medium">SOL</p>
              <p className="text-sm text-gray-400">0 SOL</p>
            </div>
            <p className="text-right">
              <p className="font-medium">$0.00</p>
              <p className="text-sm text-gray-400">0%</p>
            </p>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-medium">USDT</p>
              <p className="text-sm text-gray-400">0 USDT</p>
            </div>
            <p className="text-right">
              <p className="font-medium">$0.00</p>
              <p className="text-sm text-gray-400">—</p>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800">
        <div className="flex justify-around py-2">
          <Link href="/" className="flex flex-col items-center text-primary-500 py-1">
            <span className="text-lg">🏠</span>
            <span className="text-xs">홈</span>
          </Link>
          <Link href="/trade" className="flex flex-col items-center text-gray-500 py-1">
            <span className="text-lg">📊</span>
            <span className="text-xs">거래</span>
          </Link>
          <Link href="/settings" className="flex flex-col items-center text-gray-500 py-1">
            <span className="text-lg">⚙️</span>
            <span className="text-xs">설정</span>
          </Link>
        </div>
      </nav>
    </main>
  );
}
