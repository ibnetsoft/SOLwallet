'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import type { MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  Copy,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Check,
} from 'lucide-react';
import { useWalletStore } from '@/stores/useWalletStore';
import { useTokenOrderStore, sortSymbolsByUserOrder } from '@/stores/useTokenOrderStore';
import { getPortfolio } from '@/lib/api/balance';
import { getTokens, type Token as ApiToken } from '@/lib/api/tokens';
import { fetchSolPrice, type SolPriceData } from '@/lib/api/price';
import { useRoi } from '@/lib/hooks/useRoi';
import { getTokenLogoUrl } from '@/lib/tokenLogo';
import { Sparkline } from '@/components/Sparkline';
import { BottomNav } from '@/components/BottomNav';
import { useToast } from '@/components/Toast';
import DepositModal from '@/components/DepositModal';
import WithdrawModal from '@/components/WithdrawModal';
import { isLoggedIn } from '@/lib/api/auth';
import { useT } from '@/lib/i18n';
import type { Portfolio, WalletBalance } from '@/lib/api/balance';

const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

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
  const { t } = useT();
  const router = useRouter();
  const {
    wallets,
    activeWalletId,
    isInitialized,
    initialize,
  } = useWalletStore();

  const { showToast } = useToast();

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [solPrice, setSolPrice] = useState<SolPriceData | null>(null);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [adminTokens, setAdminTokens] = useState<ApiToken[]>([]);

  const moveUp = useTokenOrderStore((s) => s.moveUp);
  const moveDown = useTokenOrderStore((s) => s.moveDown);

  useEffect(() => {
    if (!isLoggedIn()) {
      // 추천 링크(?ref=코드)가 리다이렉트 과정에서 유실되지 않도록 쿼리스트링 유지
      const qs = typeof window !== 'undefined' ? window.location.search : '';
      router.replace(`/login${qs}`);
      return;
    }
    setAuthChecked(true);
    if (!isInitialized) {
      initialize();
    } else if (wallets.length === 0) {
      // 지갑이 없는 신규 유저의 경우 바로 설정(지갑 생성) 페이지로 이동
      router.replace('/settings?create=true');
    }
  }, [isInitialized, initialize, router, wallets.length]);

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

  useEffect(() => {
    if (!activeWalletId) return;
    const interval = setInterval(() => fetchPortfolio(true), 30_000);
    return () => clearInterval(interval);
  }, [activeWalletId]);

  // 어드민 추가 토큰 목록 조회
  useEffect(() => {
    getTokens()
      .then((tokens) => setAdminTokens(tokens.filter((t) => t.is_active)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const p = await fetchSolPrice();
      if (!cancelled && p) setSolPrice(p);
    };
    load();
    const interval = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const activeWallet = wallets.find((w) => w.isActive) || wallets[0];

  const copyAddress = useCallback(() => {
    if (!activeWallet?.publicKey) return;
    navigator.clipboard.writeText(activeWallet.publicKey).then(
      () => showToast(t('home.addressCopied')),
      () => showToast(t('home.copyFailed')),
    );
  }, [activeWallet?.publicKey, showToast, t]);

  const holdings: (WalletBalance & { publicKey: string }) | null =
    portfolio?.wallets?.[0] ?? null;
  const solBalance = holdings?.sol ?? 0;
  const rawTokens = holdings?.tokens ?? [];
  const totalUsdt = portfolio?.totalUsdt ?? 0;

  const solUsdPrice = solPrice?.usdPrice ?? 0;
  const solUsdValue = solBalance * solUsdPrice;
  const solChangePct = solPrice?.change24hPct;

  const computedTotal = solUsdPrice > 0 ? totalUsdt + solUsdValue : totalUsdt;
  
  const roi = useRoi(activeWallet?.id, computedTotal);
  const sparkData = roi.history.length >= 2 ? roi.history.map((p) => p.v) : [computedTotal, computedTotal];

  const usdtFromPortfolio =
    rawTokens.find(
      (tok) => tok.mint === USDT_MINT || tok.symbol?.toUpperCase() === 'USDT',
    ) ?? null;
  const usdtToken: DisplayToken = {
    mint: usdtFromPortfolio?.mint ?? USDT_MINT,
    symbol: 'USDT',
    decimals: usdtFromPortfolio?.decimals ?? 6,
    balance: usdtFromPortfolio?.balance ?? 0,
    badge: 'Stable',
    logoUrl: getTokenLogoUrl('USDT'),
  };

  const usdcFromPortfolio =
    rawTokens.find(
      (tok) => tok.mint === USDC_MINT || tok.symbol?.toUpperCase() === 'USDC',
    ) ?? null;
  const usdcToken: DisplayToken = {
    mint: usdcFromPortfolio?.mint ?? USDC_MINT,
    symbol: 'USDC',
    decimals: usdcFromPortfolio?.decimals ?? 6,
    balance: usdcFromPortfolio?.balance ?? 0,
    badge: 'Stable',
    logoUrl: getTokenLogoUrl('USDC'),
  };

  const solToken: DisplayToken = {
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    decimals: 9,
    balance: solBalance,
    badge: 'Staking',
    isNative: true,
    logoUrl: getTokenLogoUrl('SOL'),
  };

  const otherTokens: DisplayToken[] = rawTokens
    .filter(
      (tok) =>
        tok.mint !== USDT_MINT &&
        tok.symbol?.toUpperCase() !== 'USDT' &&
        tok.mint !== USDC_MINT &&
        tok.symbol?.toUpperCase() !== 'USDC' &&
        tok.symbol?.toUpperCase() !== 'SOL',
    )
    .map((tok) => ({
      mint: tok.mint,
      symbol: tok.symbol,
      decimals: tok.decimals,
      balance: tok.balance,
      logoUrl: tok.logoUrl || getTokenLogoUrl(tok.symbol),
    }));

  // 어드민 추가 토큰 중 잔액 목록에 없는 것(보유량 0)도 홈에 표시
  const rawMints = new Set(rawTokens.map((t) => t.mint));
  const rawSymbols = new Set(rawTokens.map((t) => t.symbol?.toUpperCase()));
  const adminOnlyTokens: DisplayToken[] = adminTokens
    .filter(
      (at) =>
        !rawMints.has(at.mint_address) &&
        at.symbol.toUpperCase() !== 'USDT' &&
        at.symbol.toUpperCase() !== 'USDC' &&
        at.symbol.toUpperCase() !== 'SOL',
    )
    .map((at) => ({
      mint: at.mint_address,
      symbol: at.symbol,
      decimals: at.decimals,
      balance: 0,
      logoUrl: getTokenLogoUrl(at.symbol),
    }));

  const allOtherTokens = [...otherTokens, ...adminOnlyTokens];

  const baseTokens: DisplayToken[] = [usdcToken, usdtToken, solToken];

  // 사용자 정렬 순서 적용: order에 있는 심볼은 순서대로, 없는 심볼(allOtherTokens)은 뒤로
  const tokenOrder = useTokenOrderStore((s) => s.order);
  const baseSymbols = baseTokens.map((t) => t.symbol);
  const otherSymbols = allOtherTokens.map((t) => t.symbol);
  const sortedBase = sortSymbolsByUserOrder(baseSymbols, tokenOrder)
    .map((sym) => baseTokens.find((t) => t.symbol === sym))
    .filter((t): t is DisplayToken => Boolean(t));
  const displayTokens: DisplayToken[] = [...sortedBase, ...allOtherTokens];

  const truncateAddr = (addr: string) =>
    `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen p-4 pb-24">
      {/* ===== Header ===== */}
      <header className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {/* Site Logo */}
            <div className="w-8 h-8 rounded-lg overflow-hidden shadow-md flex items-center justify-center bg-gray-900">
              <img src="/icons/icon-192x192.png" alt="Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">AOI Wallet</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Solana Network 상태 표시등 (모양만) */}
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-[10px] text-gray-400">{t('home.solanaNetwork')}</span>
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
              ${solUsdPrice > 0 ? solUsdPrice.toFixed(4) : '0.0000'}
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
                  aria-label={t('home.addressCopy')}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <Link
                href="/settings"
                className="text-xs text-primary-400 hover:underline"
              >
                {t('home.createWallet')}
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
          {/* Sparkline (temporarily hidden) */}
          <div className="shrink-0 hidden">
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
            <p className="text-[9px] text-gray-500 uppercase tracking-wider">{t('home.initialBalance')}</p>
            <p className="text-xs font-medium text-gray-300 tabular-nums mt-0.5">
              ${roi.initialBalance > 0 ? roi.initialBalance.toFixed(5) : '0.00000'}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-gray-500 uppercase tracking-wider">{t('home.totalProfit')}</p>
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
            <p className="text-[9px] text-gray-500 uppercase tracking-wider">{t('home.profitRate')}</p>
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
                showToast(t('home.createWalletFirst'));
              }
            }}
            className="flex flex-col items-center justify-center gap-1 bg-gray-700/40 hover:bg-gray-700/70 border border-gray-700/50 py-2.5 rounded-xl text-xs text-gray-200 transition"
          >
            <ArrowDownToLine className="w-4 h-4" strokeWidth={2} />
            <span>{t('home.deposit')}</span>
          </button>
          <button
            onClick={() => {
              if (!activeWallet) {
                showToast(t('home.createWalletFirst'));
              } else {
                setShowWithdraw(true);
              }
            }}
            className="flex flex-col items-center justify-center gap-1 bg-gray-700/40 hover:bg-gray-700/70 border border-gray-700/50 py-2.5 rounded-xl text-xs text-gray-200 transition"
          >
            <ArrowUpFromLine className="w-4 h-4" strokeWidth={2} />
            <span>{t('home.withdraw')}</span>
          </button>
          <Link
            href="/transactions"
            className="flex flex-col items-center justify-center gap-1 bg-gray-700/40 hover:bg-gray-700/70 border border-gray-700/50 py-2.5 rounded-xl text-xs text-gray-200 transition"
          >
            <History className="w-4 h-4" strokeWidth={2} />
            <span>{t('home.history')}</span>
          </Link>
        </div>
      </section>

      {/* ===== Holdings (고정 구조 — 깜빡임 방지) ===== */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">{t('home.holdings')}</h2>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">{displayTokens.length} {t('common.items')}</span>
            <button
              onClick={() => setIsEditingOrder((v) => !v)}
              className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition ${
                isEditingOrder
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
              }`}
              aria-label={isEditingOrder ? t('home.done') : t('home.editOrder')}
            >
              {isEditingOrder ? (
                <>
                  <Check className="w-3 h-3" />
                  <span>{t('home.done')}</span>
                </>
              ) : (
                <>
                  <ArrowUpDown className="w-3 h-3" />
                  <span>{t('home.editOrder')}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* displayTokens가 항상 렌더링되므로 로딩 상태와 무관하게 레이아웃 안정 */}
        <div className="space-y-2">
          {displayTokens.map((tok, idx) => {
            const isSol = tok.symbol === 'SOL';
            const isUsdt = tok.symbol === 'USDT';
            const isUsdc = tok.symbol === 'USDC';
            const isStable = isUsdt || isUsdc;
            const assetChangePct =
              isStable
                ? 0
                : isSol
                  ? solBalance > 0
                    ? (solChangePct ?? 0)
                    : 0
                  : 0;
            return (
              <AssetRow
                key={tok.mint}
                symbol={tok.symbol}
                balance={tok.balance}
                badge={tok.badge}
                logoUrl={tok.logoUrl}
                usdValue={
                  isStable
                    ? tok.balance
                    : isSol
                      ? solUsdValue
                      : tok.balance
                }
                changePct={assetChangePct}
                editMode={isEditingOrder}
                isFirst={idx === 0}
                isLast={idx === displayTokens.length - 1}
                onMoveUp={() => moveUp(tok.symbol)}
                onMoveDown={() => moveDown(tok.symbol)}
                swapHref={isStable ? '/swap' : undefined}
              />
            );
          })}
        </div>
      </section>

      {/* ===== Bottom Nav (공통 컴포넌트) ===== */}
      <BottomNav />

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
          tokens={displayTokens}
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
  editMode = false,
  isFirst = false,
  isLast = false,
  onMoveUp,
  onMoveDown,
  swapHref,
}: {
  symbol: string;
  balance: number;
  badge?: 'Stable' | 'Staking';
  logoUrl?: string;
  usdValue: number;
  changePct?: number;
  editMode?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  swapHref?: string;
}) {
  const { t } = useT();

  const badgeStyle =
    badge === 'Stable'
      ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
      : badge === 'Staking'
        ? 'bg-purple-500/15 text-purple-400 border border-purple-500/20'
        : '';

  const [imgError, setImgError] = useState(false);

  // USDT/USDC는 스테이블코인(기축통화)이라 거래 불가 → 스왑 페이지로 이동
  const isStable = symbol === 'USDT' || symbol === 'USDC';
  const isTradable = !isStable;
  const tradeHref = swapHref ?? `/trade?type=buy&symbol=${symbol}`;

  // 편집 모드에서는 내비게이션 비활성화
  const effectiveHref = editMode ? '#' : tradeHref;
  const effectiveClickable = editMode ? false : isTradable || !!swapHref;

  return (
    <Link
      href={effectiveHref}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (!effectiveClickable) e.preventDefault();
      }}
      aria-disabled={!effectiveClickable}
      className={`bg-gray-800/50 rounded-xl p-3.5 flex items-center justify-between min-h-[64px] transition-colors ${
        effectiveClickable
          ? 'hover:bg-gray-700/40 active:bg-gray-700/60 cursor-pointer'
          : 'cursor-default'
      }`}
    >
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
                {badge === 'Stable' ? t('home.stable') : t('home.staking')}
              </span>
            )}
          </div>
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

      {/* 우측: 편집 모드일 때 화살표 버튼, 아닐 때 금액/변동률 */}
      {editMode ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isFirst) onMoveUp?.();
            }}
            disabled={isFirst}
            aria-label={t('home.moveUp')}
            className={`p-1.5 rounded-lg transition ${
              isFirst
                ? 'text-gray-600 cursor-not-allowed'
                : 'text-gray-300 hover:bg-gray-700 active:bg-gray-600'
            }`}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isLast) onMoveDown?.();
            }}
            disabled={isLast}
            aria-label={t('home.moveDown')}
            className={`p-1.5 rounded-lg transition ${
              isLast
                ? 'text-gray-600 cursor-not-allowed'
                : 'text-gray-300 hover:bg-gray-700 active:bg-gray-600'
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="text-right">
          <p className="font-medium text-sm tabular-nums">
            ${usdValue > 0 ? usdValue.toFixed(5) : '0.00000'}
          </p>
          <p className="text-[10px] text-gray-400 tabular-nums mt-0.5">
            {balance.toFixed(4)} {symbol}
          </p>
        </div>
      )}
    </Link>
  );
}

export default function Home() {
  const { t } = useT();
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">{t('common.loading')}</div>}>
      <HomePage />
    </Suspense>
  );
}