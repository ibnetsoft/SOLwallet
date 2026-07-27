'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowDownUp, Info } from 'lucide-react';
import { useWalletStore } from '@/stores/useWalletStore';
import { useSwapStore } from '@/stores/useSwapStore';
import { getPortfolio } from '@/lib/api/balance';
import { getTokenLogoUrl } from '@/lib/tokenLogo';
import { BottomNav } from '@/components/BottomNav';
import { useToast } from '@/components/Toast';
import PinModal from '@/components/PinModal';
import { isLoggedIn } from '@/lib/api/auth';
import { useT } from '@/lib/i18n';
import type { Portfolio, WalletBalance } from '@/lib/api/balance';

export default function SwapPage() {
  const { t } = useT();
  const router = useRouter();
  const { showToast } = useToast();

  const {
    wallets,
    activeWalletId,
    isInitialized,
    initialize,
  } = useWalletStore();

  const {
    inputToken,
    outputToken,
    inputAmount,
    quote,
    isQuoting,
    isExecuting,
    setInputAmount,
    swapDirection,
    fetchQuote,
    executeSwap,
  } = useSwapStore();

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinError, setPinError] = useState('');

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

  // 포트폴리오(잔액) 조회
  const fetchPortfolio = useCallback(async () => {
    if (!activeWalletId) return;
    try {
      const data = await getPortfolio();
      setPortfolio(data);
    } catch {
      // 무시
    }
  }, [activeWalletId]);

  useEffect(() => {
    fetchPortfolio();
  }, [activeWalletId, fetchPortfolio]);

  const activeWallet = wallets.find((w) => w.isActive) || wallets[0];

  // 입력 토큰의 보유 잔액
  const holdings: (WalletBalance & { publicKey: string }) | null =
    portfolio?.wallets?.[0] ?? null;
  const inputBalance =
    holdings?.tokens?.find(
      (tok) => tok.mint === inputToken.mint,
    )?.balance ?? 0;

  // 디바운스된 견적 조회 (입력값/방향 변경 시 500ms 후)
  useEffect(() => {
    if (!activeWallet?.id || !inputAmount || Number(inputAmount) <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      fetchQuote(activeWallet.id);
    }, 500);
    return () => clearTimeout(timer);
  }, [inputAmount, inputToken, outputToken, activeWallet?.id, fetchQuote]);

  // 예상 출력 수량 (atomic → human)
  const outAmountHuman = (() => {
    if (!quote) return '0';
    const atomic = Number(quote.quoteInfo.outAmount);
    if (!isFinite(atomic) || atomic <= 0) return '0';
    return (atomic / Math.pow(10, outputToken.decimals)).toFixed(6);
  })();

  // 환율: 1 input = ? output
  const rate = (() => {
    const inp = Number(inputAmount);
    const out = Number(outAmountHuman);
    if (!inp || !out) return 0;
    return out / inp;
  })();

  // 잔액 초과 검증
  const amountNum = Number(inputAmount) || 0;
  const insufficient = amountNum > 0 && amountNum > inputBalance;
  const canSwap =
    amountNum > 0 && !insufficient && !isExecuting && !!activeWallet;

  const handleMax = () => {
    setInputAmount(inputBalance > 0 ? String(inputBalance) : '');
  };

  const handleExecute = async (pin: string) => {
    setPinError('');
    try {
      const result = await executeSwap(pin);
      setShowPinModal(false);
      showToast(t('swap.success'));
      if (result.txSignature) {
        showToast(`📝 Tx: ${result.txSignature.slice(0, 8)}...`);
      }
      // 잔액 새로고침
      fetchPortfolio();
    } catch (err) {
      setPinError(err instanceof Error ? err.message : t('swap.failed'));
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen p-4 pb-24">
      {/* Header */}
      <header className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-xl">←</Link>
        <h1 className="text-xl font-bold">{t('swap.title')}</h1>
      </header>

      {/* ===== Swap Card ===== */}
      <section className="space-y-2">
        {/* From */}
        <div className="bg-gray-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">{t('swap.from')}</span>
            <span className="text-xs text-gray-400">
              {t('swap.balance')}: {inputBalance.toFixed(6)}{' '}
              <button
                onClick={handleMax}
                className="text-primary-400 hover:underline ml-1"
              >
                {t('swap.max')}
              </button>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              inputMode="decimal"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0.0"
              className="flex-1 bg-transparent text-2xl font-bold outline-none tabular-nums placeholder:text-gray-600"
            />
            <TokenBadge symbol={inputToken.symbol} logoUrl={getTokenLogoUrl(inputToken.symbol)} />
          </div>
        </div>

        {/* Direction Toggle */}
        <div className="flex justify-center -my-1 relative z-10">
          <button
            onClick={swapDirection}
            className="bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl p-2 transition border-4 border-gray-900"
            aria-label="방향 전환"
          >
            <ArrowDownUp className="w-4 h-4" />
          </button>
        </div>

        {/* To */}
        <div className="bg-gray-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">{t('swap.to')}</span>
            <span className="text-xs text-gray-400">
              {isQuoting ? t('swap.gettingQuote') : ''}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-2xl font-bold tabular-nums text-gray-300">
              {outAmountHuman}
            </div>
            <TokenBadge symbol={outputToken.symbol} logoUrl={getTokenLogoUrl(outputToken.symbol)} />
          </div>
        </div>
      </section>

      {/* ===== Swap Info ===== */}
      {quote && (
        <section className="mt-4 bg-gray-800/30 rounded-xl p-3 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-gray-400">{t('swap.rate')}</span>
            <span className="tabular-nums">
              1 {inputToken.symbol} = {rate.toFixed(6)} {outputToken.symbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('swap.slippage')}</span>
            <span className="tabular-nums">0.5%</span>
          </div>
          {quote.quoteInfo.priceImpactPct > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-400">{t('swap.priceImpact')}</span>
              <span className="tabular-nums">
                {(quote.quoteInfo.priceImpactPct * 100).toFixed(3)}%
              </span>
            </div>
          )}
        </section>
      )}

      {/* Insufficient balance warning */}
      {insufficient && (
        <p className="mt-3 text-xs text-red-400 text-center">
          {t('swap.insufficientBalance')}
        </p>
      )}

      {/* ===== Swap Notice (고지 사항) ===== */}
      <section className="mt-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3">
        <div className="flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-yellow-300 mb-1.5">
              {t('swap.noticeTitle')}
            </p>
            <ul className="space-y-1 text-[10px] leading-relaxed text-yellow-200/80">
              <li className="flex gap-1.5">
                <span className="text-yellow-400/60 shrink-0">•</span>
                <span>{t('swap.noticeSlippage')}</span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-yellow-400/60 shrink-0">•</span>
                <span>{t('swap.noticeVariableFee')}</span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-yellow-400/60 shrink-0">•</span>
                <span>{t('swap.noticeDelayRisk')}</span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-yellow-400/60 shrink-0">•</span>
                <span>{t('swap.noticeStablecoin')}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ===== Execute Button ===== */}
      <button
        onClick={() => {
          if (!canSwap) return;
          setPinError('');
          setShowPinModal(true);
        }}
        disabled={!canSwap}
        className={`mt-5 w-full py-3.5 rounded-xl font-bold text-sm transition ${
          canSwap
            ? 'bg-primary-600 hover:bg-primary-500 active:bg-primary-700 text-white'
            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
        }`}
      >
        {isExecuting ? t('swap.swapping') : t('swap.execute')}
      </button>

      <BottomNav />

      {/* PIN Modal for signing */}
      <PinModal
        isOpen={showPinModal}
        title={t('swap.title')}
        subtitle={t('swap.execute')}
        onConfirm={handleExecute}
        onCancel={() => {
          setShowPinModal(false);
          setPinError('');
        }}
        error={pinError}
      />
    </main>
  );
}

// ===== Token Badge (로고 + 심볼) =====
function TokenBadge({
  symbol,
  logoUrl,
}: {
  symbol: string;
  logoUrl?: string;
}) {
  const [imgError, setImgError] = useState(false);
  return (
    <div className="flex items-center gap-2 bg-gray-700/60 rounded-full pl-1 pr-3 py-1 shrink-0">
      <div className="w-6 h-6 rounded-full overflow-hidden bg-gray-600 flex items-center justify-center">
        {logoUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={symbol}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="text-[10px] font-bold text-gray-300">
            {symbol.charAt(0)}
          </span>
        )}
      </div>
      <span className="text-sm font-medium">{symbol}</span>
    </div>
  );
}
