'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';

function TradeContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get('type') || 'buy';

  return (
    <main className="min-h-screen p-4 pb-24">
      {/* Header */}
      <header className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-xl">←</Link>
        <h1 className="text-xl font-bold">
          {type === 'buy' ? '📈 매수 주문' : '📉 매도 주문'}
        </h1>
      </header>

      {/* Buy/Sell Toggle */}
      <div className="flex bg-gray-800 rounded-xl p-1 mb-6">
        <Link
          href="/trade?type=buy"
          className={`flex-1 py-2 rounded-lg text-center text-sm font-medium transition ${
            type === 'buy' ? 'bg-green-600 text-white' : 'text-gray-400'
          }`}
        >
          매수 (BUY)
        </Link>
        <Link
          href="/trade?type=sell"
          className={`flex-1 py-2 rounded-lg text-center text-sm font-medium transition ${
            type === 'sell' ? 'bg-red-600 text-white' : 'text-gray-400'
          }`}
        >
          매도 (SELL)
        </Link>
      </div>

      {/* Token Selection */}
      <section className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">토큰 선택</label>
        <div className="bg-gray-800/50 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="font-medium">토큰을 선택하세요</p>
            <p className="text-sm text-gray-400">기축통화: USDT</p>
          </div>
          <span className="text-gray-400">▼</span>
        </div>
      </section>

      {/* Price Input */}
      <section className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">지정가 (USDT)</label>
        <div className="bg-gray-800/50 rounded-xl p-4 flex items-center gap-2">
          <input
            type="number"
            placeholder="가격을 입력하세요"
            className="bg-transparent flex-1 outline-none text-white placeholder-gray-500"
          />
          <button className="bg-gray-700 text-xs px-2 py-1 rounded">
            최근가
          </button>
        </div>
      </section>

      {/* Amount Input */}
      <section className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">수량</label>
        <div className="bg-gray-800/50 rounded-xl p-4">
          <input
            type="number"
            placeholder="수량을 입력하세요"
            className="bg-transparent w-full outline-none text-white placeholder-gray-500 mb-3"
          />
          <div className="flex gap-2">
            {['25%', '50%', '75%', '100%'].map((pct) => (
              <button
                key={pct}
                className="flex-1 bg-gray-700 text-xs py-1.5 rounded-lg text-gray-300 hover:bg-gray-600 transition"
              >
                {pct}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Order Summary */}
      <section className="bg-gray-800/50 rounded-xl p-4 mb-6 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">주문 금액</span>
          <span>$0.00</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">수수료 (1%)</span>
          <span>$0.00</span>
        </div>
        <hr className="border-gray-700" />
        <div className="flex justify-between font-medium">
          <span>총 지불 금액</span>
          <span>$0.00</span>
        </div>
      </section>

      {/* Execute Button */}
      <button
        className={`w-full py-4 rounded-xl font-bold text-lg transition ${
          type === 'buy'
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-red-600 hover:bg-red-700 text-white'
        }`}
      >
        {type === 'buy' ? '📈 매수 주문하기 (Limit)' : '📉 매도 주문하기 (Limit)'}
      </button>

      {/* Active Orders */}
      <section className="mt-6">
        <h2 className="text-lg font-bold mb-3">미체결 주문</h2>
        <p className="text-sm text-gray-400">미체결 주문이 없습니다</p>
      </section>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800">
        <div className="flex justify-around py-2">
          <Link href="/" className="flex flex-col items-center text-gray-500 py-1">
            <span className="text-lg">🏠</span>
            <span className="text-xs">홈</span>
          </Link>
          <Link href="/trade" className="flex flex-col items-center text-primary-500 py-1">
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

export default function TradePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">로딩...</div>}>
      <TradeContent />
    </Suspense>
  );
}
