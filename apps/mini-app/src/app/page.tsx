'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWalletStore } from '@/stores/useWalletStore';
import { getPortfolio } from '@/lib/api/balance';
import { useToast } from '@/components/Toast';
import { SkeletonStatCard, SkeletonCard } from '@/components/Skeleton';
import DepositModal from '@/components/DepositModal';
import WithdrawModal from '@/components/WithdrawModal';
import { isLoggedIn } from '@/lib/api/auth';
import type { Portfolio } from '@/lib/api/balance';

function HomePage() {
  const router = useRouter();
  const {
    wallets,
    activeWalletId,
    isInitialized,
    initialize,
  } = useWalletStore();

  const { showToast } = useToast();

  // 포트폴리오 데이터
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // 초기화 + auth 체크
  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    setAuthChecked(true);
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize, router]);

  // 포트폴리오 조회 (silent: 데이터 있으면 로딩 표시 안 함)
  const fetchPortfolio = useCallback(async (silent = false) => {
    if (!activeWalletId) return;
    // 첫 로드이거나 데이터가 없을 때만 로딩 표시
    if (!silent || !portfolio) {
      setIsLoadingPortfolio(true);
    }
    try {
      const data = await getPortfolio();
      setPortfolio(data);
    } catch {
      // 무시
    } finally {
      setIsLoadingPortfolio(false);
    }
  }, [activeWalletId, portfolio]);

  useEffect(() => {
    fetchPortfolio();
  }, [activeWalletId]);

  // 30초마다 자동 갱신 (silent — 깜빡임 없이)
  useEffect(() => {
    if (!activeWalletId) return;
    const interval = setInterval(() => fetchPortfolio(true), 30_000);
    return () => clearInterval(interval);
  }, [activeWalletId]);

  const activeWallet = wallets.find((w) => w.isActive) || wallets[0];

  // 주소 복사
  const copyAddress = useCallback(() => {
    if (!activeWallet?.publicKey) return;
    navigator.clipboard.writeText(activeWallet.publicKey).then(
      () => showToast('📋 주소가 복사되었습니다.'),
      () => showToast('❌ 복사에 실패했습니다.'),
    );
  }, [activeWallet?.publicKey, showToast]);

  // 포트폴리오에서 데이터 추출
  const totalUsdt = portfolio?.totalUsdt ?? 0;
  const holdings = portfolio?.wallets?.[0] ?? null;
  const solBalance = holdings?.sol ?? 0;
  const tokenBalances = holdings?.tokens ?? [];

  // 주소 축약
  const truncateAddr = (addr: string) =>
    `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  // auth 확인 전에는 로딩
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">로딩...</p>
      </div>
    );
  }

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
          {activeWallet ? (
            <div className="flex items-center justify-between">
              <p className="text-sm font-mono">
                {truncateAddr(activeWallet.publicKey)}
              </p>
              <button
                onClick={copyAddress}
                className="text-xs bg-gray-700 px-2 py-1 rounded hover:bg-gray-600 transition"
              >
                복사
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              <Link href="/settings" className="text-primary-400 hover:underline">
                지갑을 생성해주세요 →
              </Link>
            </p>
          )}
        </div>
      </header>

      {/* Total Balance */}
      <section className="bg-gray-800/50 rounded-xl p-4 mb-6">
        <p className="text-xs text-gray-400 mb-1">전체 자산 (USDT)</p>
        {isLoadingPortfolio ? (
          <SkeletonStatCard />
        ) : (
          <>
            <p className="text-3xl font-bold">
              ${totalUsdt > 0 ? totalUsdt.toFixed(2) : '0.00'}
            </p>
            <div className="flex gap-4 mt-2">
              <span className="text-sm text-gray-400">
                SOL: {solBalance.toFixed(4)}
              </span>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  if (activeWallet) {
                    setShowDeposit(true);
                  } else {
                    showToast('⚠️ 먼저 지갑을 생성해주세요.');
                  }
                }}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
              >
                입금
              </button>
              <button
                className="flex-1 bg-gray-700 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-600 transition"
                onClick={() => {
                  if (!activeWallet) {
                    showToast('⚠️ 먼저 지갑을 생성해주세요.');
                  } else if (solBalance <= 0) {
                    showToast('⚠️ 출금 가능한 SOL 잔액이 없습니다.');
                  } else {
                    setShowWithdraw(true);
                  }
                }}
              >
                출금
              </button>
              <Link
                href="/settings"
                className="flex-1 bg-gray-700 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-600 transition text-center"
              >
                지갑관리
              </Link>
            </div>
          </>
        )}
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
        {isLoadingPortfolio ? (
          <div className="space-y-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : tokenBalances.length > 0 || solBalance > 0 ? (
          <div className="space-y-2">
            {/* SOL */}
            <div className="bg-gray-800/50 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">SOL</p>
                <p className="text-sm text-gray-400">{solBalance.toFixed(4)} SOL</p>
              </div>
              <p className="text-right">
                <p className="font-medium">
                  ${solBalance > 0 ? solBalance.toFixed(2) : '0.00'}
                </p>
              </p>
            </div>
            {/* SPL Tokens */}
            {tokenBalances.map((t) => (
              <div
                key={t.mint}
                className="bg-gray-800/50 rounded-xl p-4 flex items-center justify-between"
              >
                <div>
                  <p className="font-medium">{t.symbol}</p>
                  <p className="text-sm text-gray-400">{t.balance.toFixed(4)} {t.symbol}</p>
                </div>
                <p className="text-right">
                  <p className="font-medium">
                    ${t.balance > 0 ? t.balance.toFixed(2) : '0.00'}
                  </p>
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-gray-500 text-sm">
            보유 자산이 없습니다. 입금하여 시작하세요.
          </div>
        )}
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

      {/* Deposit QR Modal */}
      {activeWallet && (
        <DepositModal
          isOpen={showDeposit}
          walletAddress={activeWallet.publicKey}
          onClose={() => setShowDeposit(false)}
        />
      )}

      {/* Withdraw Modal */}
      {activeWallet && (
        <WithdrawModal
          isOpen={showWithdraw}
          walletId={activeWallet.id}
          walletAddress={activeWallet.publicKey}
          solBalance={solBalance}
          onClose={() => setShowWithdraw(false)}
        />
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">로딩...</div>}>
      <HomePage />
    </Suspense>
  );
}
