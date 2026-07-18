'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  Copy,
  Pickaxe,
  Home as HomeIcon,
  BarChart3,
  Settings,
} from 'lucide-react';
import { useWalletStore } from '@/stores/useWalletStore';
import { getPortfolio } from '@/lib/api/balance';
import { fetchSolPrice, type SolPriceData } from '@/lib/api/price';
import { useRoi } from '@/lib/hooks/useRoi';
import { getTokenLogoUrl } from '@/lib/tokenLogo';
import { Sparkline } from '@/components/Sparkline';
import { useToast } from '@/components/Toast';
import DepositModal from '@/components/DepositModal';
import WithdrawModal from '@/components/WithdrawModal';
import { isLoggedIn } from '@/lib/api/auth';
import type { Portfolio, WalletBalance } from '@/lib/api/balance';

// 화면에 항상 노출할 기본 토큰 목록 (잔고 0이어도 표시)
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'; // 메인넷 USDT

interface DisplayToken {
  mint: string;
  symbol: string;
  decimals: number;
  balance: number;
  badge?: 'Stable' | 'Staking';
  isNative?: boolean;
  logoUrl?: string;
}

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
  // SOL 시세 (Jupiter Price API)
  const [solPrice, setSolPrice] = useState<SolPriceData | null>(null);

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

  // 30초마다 자동 갱신 (silent)
  useEffect(() => {
    if (!activeWalletId) return;
    const interval = setInterval(() => fetchPortfolio(true), 30_000);
    return () => clearInterval(interval);
  }, [activeWalletId]);

  // SOL 시세 갱신 — 60초마다 (깜빡임 없이 상태만 업데이트)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const p = await fetchSolPrice();
      if (!cancelled && p) setSolPrice(p);
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const activeWallet = wallets.find((w) => w.isActive) || wallets[0];

  // 주소 복사
  const copyAddress = useCallback(() => {
    if (!activeWallet?.publicKey) return;
    navigator.clipboard.writeText(activeWallet.publicKey).then(
      () => showToast('주소가 복사되었습니다.'),
      () => showToast('복사에 실패했습니다.'),
    );
  }, [activeWallet?.publicKey, showToast]);

  // ===== 표시용 데이터 구성 =====
  const holdings: (WalletBalance & { publicKey: string }) | null =
    portfolio?.wallets?.[0] ?? null;
  const solBalance = holdings?.sol ?? 0;
  const rawTokens = holdings?.tokens ?? [];
  const totalUsdt = portfolio?.totalUsdt ?? 0;

  // SOL USD 환산가 — Jupiter 시세 기반 (없으면 0)
  const solUsdPrice = solPrice?.usdPrice ?? 0;
  const solUsdValue = solBalance * solUsdPrice;
  const solChangePct = solPrice?.change24hPct;

  // 총 자산 — SOL 시세 반영
  const computedTotal = solUsdPrice > 0 ? totalUsdt + solUsdValue : totalUsdt;

  // ROI 추적 (localStorage 기반)
  const roi = useRoi(computedTotal);
  const sparkData = roi.history.length >= 2 ? roi.history.map((p) => p.v) : [computedTotal, computedTotal];

  // 기본 토큰 강제 포함: USDT(Stable), SOL(Staking)
  // 1) USDT — 보유 중이면 그것 사용, 없으면 0으로 생성
  const usdtFromPortfolio =
    rawTokens.find(
      (t) => t.mint === USDT_MINT || t.symbol?.toUpperCase() === 'USDT',
    ) ?? null;
  const usdtToken: DisplayToken = {
    mint: usdtFromPortfolio?.mint ?? USDT_MINT,
    symbol: 'USDT',
    decimals: usdtFromPortfolio?.decimals ?? 6,
    balance: usdtFromPortfolio?.balance ?? 0,
    badge: 'Stable',
    logoUrl: getTokenLogoUrl('USDT'),
  };

  // 2) SOL — 항상 2번째
  const solToken: DisplayToken = {
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    decimals: 9,
    balance: solBalance,
    badge: 'Staking',
    isNative: true,
    logoUrl: getTokenLogoUrl('SOL'),
  };

  // 3) 나머지 토큰 — USDT/SOL 제외
  const otherTokens: DisplayToken[] = rawTokens
    .filter(
      (t) =>
        t.mint !== USDT_MINT &&
        t.symbol?.toUpperCase() !== 'USDT' &&
        t.symbol?.toUpperCase() !== 'SOL',
    )
    .map((t) => ({
      mint: t.mint,
      symbol: t.symbol,
      decimals: t.decimals,
      balance: t.balance,
      logoUrl: t.logoUrl || getTokenLogoUrl(t.symbol),
    }));

  const displayTokens: DisplayToken[] = [usdtToken, solToken, ...otherTokens];

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
      {/* ===== Header ===== */}
      <header className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {/* DEX MINER BOT Logo */}
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-md">
              <Pickaxe className="w-5 h-5 text-gray-900" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">DEX MINER BOT</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Solana Network 상태 표시등 (모양만) */}
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-[10px] text-gray-400">Solana Network</span>
            </div>
          </div>
        </div>

        {/* 두 개의 독립된 라운드 박스: SOL 시세 / 지갑 주소 */}
        <div className="flex items-center gap-2">
          {/* 좌측 박스: SOL 현재가 + 변동율 */}
          <div className="bg-gray-800/50 rounded-xl px-3 py-2 flex items-baseline gap-1.5 shrink-0">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              SOL
            </span>
            <span className="text-sm font-medium tabular-nums">
              ${solUsdPrice > 0 ? solUsdPrice.toFixed(2) : '0.00'}
            </span>
            {typeof solChangePct === 'number' && solUsdPrice > 0 && (
              <span
                className={`text-[10px] tabular-nums ${
                  solChangePct > 0
                    ? 'text-green-400'
                    : solChangePct < 0
                      ? 'text-red-400'
                      : 'text-gray-500'
                }`}
              >
                {solChangePct > 0 ? '▲' : solChangePct < 0 ? '▼' : ''}{' '}
                {Math.abs(solChangePct).toFixed(2)}%
              </span>
            )}
          </div>

          {/* 우측 박스: 지갑 주소 + 복사 버튼 */}
          <div className="bg-gray-800/50 rounded-xl px-3 py-2 flex items-center justify-between gap-2 min-w-0 flex-1">
            {activeWallet ? (
              <>
                <p className="text-xs font-mono text-gray-400 truncate">
                  {truncateAddr(activeWallet.publicKey)}
                </p>
                <button
                  onClick={copyAddress}
                  className="p-1 rounded-lg hover:bg-gray-700/70 transition text-gray-400 shrink-0"
                  aria-label="주소 복사"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <Link
                href="/settings"
                className="text-xs text-primary-400 hover:underline"
              >
                지갑 생성 →
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ===== Total Balance (고정 높이 — 레이아웃 흔들림 방지) ===== */}
      <section className="bg-gray-800/50 rounded-2xl p-5 mb-5">
        {/* 금액(좌) + Sparkline(우) 같은 행 */}
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">
              ${computedTotal > 0 ? computedTotal.toFixed(5) : '0.00000'}
            </span>
            <span className="text-xs text-gray-500">USDT</span>
          </div>
          <div className="shrink-0">
            <Sparkline
              data={sparkData}
              width={140}
              height={40}
              startOffset={0}
            />
          </div>
        </div>

        {/* ROI 서브 통계 — 최초잔고 / 총 수익 / 수익률 */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div>
            <p className="text-[9px] text-gray-500 uppercase tracking-wider">최초잔고</p>
            <p className="text-xs font-medium text-gray-300 tabular-nums mt-0.5">
              ${roi.initialBalance > 0 ? roi.initialBalance.toFixed(5) : '0.00000'}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-gray-500 uppercase tracking-wider">총 수익</p>
            <p
              className={`text-xs font-medium tabular-nums mt-0.5 ${
                roi.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {roi.totalProfit >= 0 ? '+' : ''}
              {roi.totalProfit.toFixed(5)}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-gray-500 uppercase tracking-wider">수익률</p>
            <p
              className={`text-xs font-medium tabular-nums mt-0.5 ${
                roi.roiPct >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {roi.roiPct >= 0 ? '+' : ''}
              {roi.roiPct.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Quick Action Buttons — 입금 / 출금 / 입출금내역 */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          <button
            onClick={() => {
              if (activeWallet) {
                setShowDeposit(true);
              } else {
                showToast('먼저 지갑을 생성해주세요.');
              }
            }}
            className="flex flex-col items-center justify-center gap-1 bg-gray-700/40 hover:bg-gray-700/70 border border-gray-700/50 py-2.5 rounded-xl text-xs text-gray-200 transition"
          >
            <ArrowDownToLine className="w-4 h-4" strokeWidth={2} />
            <span>입금</span>
          </button>
          <button
            onClick={() => {
              if (!activeWallet) {
                showToast('먼저 지갑을 생성해주세요.');
              } else if (solBalance <= 0) {
                showToast('출금 가능한 SOL 잔액이 없습니다.');
              } else {
                setShowWithdraw(true);
              }
            }}
            className="flex flex-col items-center justify-center gap-1 bg-gray-700/40 hover:bg-gray-700/70 border border-gray-700/50 py-2.5 rounded-xl text-xs text-gray-200 transition"
          >
            <ArrowUpFromLine className="w-4 h-4" strokeWidth={2} />
            <span>출금</span>
          </button>
          <Link
            href="/transactions"
            className="flex flex-col items-center justify-center gap-1 bg-gray-700/40 hover:bg-gray-700/70 border border-gray-700/50 py-2.5 rounded-xl text-xs text-gray-200 transition"
          >
            <History className="w-4 h-4" strokeWidth={2} />
            <span>내역</span>
          </Link>
        </div>
      </section>

      {/* ===== Trading Buttons ===== */}
      <section className="mb-5">
        <div className="flex gap-2 justify-center">
          <Link
            href="/trade?type=buy"
            className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl text-sm font-bold transition text-center"
          >
            BUY
          </Link>
          <Link
            href="/trade?type=sell"
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-bold transition text-center"
          >
            SELL
          </Link>
        </div>
      </section>

      {/* ===== Holdings (고정 구조 — 깜빡임 방지) ===== */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">보유 자산</h2>
          <span className="text-[10px] text-gray-500">{displayTokens.length} 종목</span>
        </div>

        {/* displayTokens가 항상 렌더링되므로 로딩 상태와 무관하게 레이아웃 안정 */}
        <div className="space-y-2">
          {displayTokens.map((t) => {
            const isSol = t.symbol === 'SOL';
            const isUsdt = t.symbol === 'USDT';
            // 내 자산가치 기준 변동율 — 보유량 0이면 0%, 보유 중인 SOL만 시세 변동율 반영
            const assetChangePct =
              isUsdt
                ? 0 // 스테이블 — 0%
                : isSol
                  ? solBalance > 0
                    ? (solChangePct ?? 0)
                    : 0 // SOL 보유량 0 → 자산 변동 없음
                  : 0; // 기타 토큰은 데이터 없음 → 0%
            return (
              <AssetRow
                key={t.mint}
                symbol={t.symbol}
                balance={t.balance}
                badge={t.badge}
                logoUrl={t.logoUrl}
                usdValue={
                  isUsdt
                    ? t.balance
                    : isSol
                      ? solUsdValue
                      : t.balance
                }
                changePct={assetChangePct}
              />
            );
          })}
        </div>
      </section>

      {/* ===== Bottom Nav ===== */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800">
        <div className="flex justify-around py-2">
          <Link href="/" className="flex flex-col items-center gap-0.5 text-primary-500 py-1">
            <HomeIcon className="w-5 h-5" strokeWidth={2} />
            <span className="text-[10px]">홈</span>
          </Link>
          <Link href="/trade" className="flex flex-col items-center gap-0.5 text-gray-500 py-1">
            <BarChart3 className="w-5 h-5" strokeWidth={2} />
            <span className="text-[10px]">거래</span>
          </Link>
          <Link href="/settings" className="flex flex-col items-center gap-0.5 text-gray-500 py-1">
            <Settings className="w-5 h-5" strokeWidth={2} />
            <span className="text-[10px]">설정</span>
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

// ===== 자산 행 컴포넌트 =====
function AssetRow({
  symbol,
  balance,
  badge,
  logoUrl,
  usdValue,
  changePct,
}: {
  symbol: string;
  balance: number;
  badge?: 'Stable' | 'Staking';
  logoUrl?: string;
  usdValue: number;
  changePct?: number;
}) {
  const badgeStyle =
    badge === 'Stable'
      ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
      : badge === 'Staking'
        ? 'bg-purple-500/15 text-purple-400 border border-purple-500/20'
        : '';

  const [imgError, setImgError] = useState(false);

  return (
    <div className="bg-gray-800/50 rounded-xl p-3.5 flex items-center justify-between min-h-[64px]">
      <div className="flex items-center gap-3">
        {/* 토큰 로고 — 이미지 우선, 실패 시 첫 글자 fallback */}
        <div className="w-9 h-9 rounded-full overflow-hidden bg-gray-700 flex items-center justify-center shrink-0">
          {logoUrl && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={symbol}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="text-xs font-bold text-gray-300">
              {symbol.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm">{symbol}</p>
            {badge && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wide ${badgeStyle}`}>
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 tabular-nums mt-0.5">
            {balance.toFixed(4)} {symbol}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-medium text-sm tabular-nums">
          ${usdValue > 0 ? usdValue.toFixed(5) : '0.00000'}
        </p>
        {typeof changePct === 'number' && (
          <p
            className={`text-[10px] tabular-nums mt-0.5 ${
              changePct > 0
                ? 'text-green-400'
                : changePct < 0
                  ? 'text-red-400'
                  : 'text-gray-500' // 0% — 회색
            }`}
          >
            {changePct > 0 ? '▲ ' : changePct < 0 ? '▼ ' : ''}
            {Math.abs(changePct).toFixed(2)}%
          </p>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">로딩...</div>}>
      <HomePage />
    </Suspense>
  );
}
