'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { RefreshCw, ArrowDownToLine } from 'lucide-react';
import { useTradeStore } from '@/stores/useTradeStore';
import { useWalletStore } from '@/stores/useWalletStore';
import { useToast, type ToastVariant } from '@/components/Toast';
import PinModal from '@/components/PinModal';
import { BottomNav } from '@/components/BottomNav';
import { SkeletonCard } from '@/components/Skeleton';
import { QUICK_AMOUNT_RATIOS, USDT_MINT } from '@solwallet/config';
import { getWalletBalance, type WalletBalance } from '@/lib/api/balance';
import { isLoggedIn } from '@/lib/api/auth';
import { getTokenLogoUrl } from '@/lib/tokenLogo';
import { useT } from '@/lib/i18n';
import { truncateDecimals } from '@/lib/format';
import { getErrorVariant } from '@/lib/api/errorSeverity';
import { ApiError } from '@/lib/api/client';

// ===== Token Logo (로고 이미지 + fallback) =====
function TokenLogo({ symbol }: { symbol: string }) {
  const [imgError, setImgError] = useState(false);
  const logoUrl = getTokenLogoUrl(symbol);
  return (
    <div className="w-5 h-5 rounded-full overflow-hidden bg-gray-600 flex items-center justify-center shrink-0">
      {!imgError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={symbol}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="text-[9px] font-bold text-gray-300">{symbol.charAt(0)}</span>
      )}
    </div>
  );
}

const PRICE_DECIMALS = 6;

function normalizePriceInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;

  const integerPart = cleaned.slice(0, firstDot);
  const decimalPart = cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, PRICE_DECIMALS);
  return `${integerPart}.${decimalPart}`;
}

function TradeContent() {
  const { t } = useT();
  const {
    side, setSide,
    selectedToken, setSelectedToken,
    price, setPrice,
    quantity, setQuantity,
    currentPrice,
    feeRate,
    orderbook,
    tokens,
    activeOrders,
    orderHistory,
    historyHasMore,
    historyCursor,
    isLoadingMoreHistory,
    isSubmitting,
    fetchTokens,
    fetchFeeRate,
    fetchOrderbook,
    fetchCurrentPrice,
    fetchActiveOrders,
    fetchOrderHistory,
    fetchMoreHistory,
    applyCurrentPrice,
    createAndSubmitOrder,
    cancelOrder,
    withdrawFunds,
  } = useTradeStore();

  const { wallets, initialize } = useWalletStore();
  const { showToast } = useToast();
  const searchParams = useSearchParams();

  const [showPinModal, setShowPinModal] = useState(false);
  const [pinError, setPinError] = useState<{ msg: string; variant: ToastVariant } | null>(null);
  const [showTokenDropdown, setShowTokenDropdown] = useState(false);
  const [showCancelPinModal, setShowCancelPinModal] = useState(false);
  const [cancelPinError, setCancelPinError] = useState<{ msg: string; variant: ToastVariant } | null>(null);
  const [pendingCancelOrderId, setPendingCancelOrderId] = useState<string | null>(null);
  const [showWithdrawPinModal, setShowWithdrawPinModal] = useState(false);
  const [withdrawPinError, setWithdrawPinError] = useState<{ msg: string; variant: ToastVariant } | null>(null);
  const [activeTab, setActiveTab] = useState<'open' | 'history'>('open');

  // 무한 스크롤 — History 탭에서 sentinel이 보이면 다음 페이지 로드
  const sentinelRef = useRef<HTMLDivElement>(null);

  // wallet store 초기화 보장 — 홈을 거치지 않고 trade로 직진한 경우 대응
  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchMoreHistory();
        }
      },
      { rootMargin: '100px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, historyHasMore, historyCursor, fetchMoreHistory]);

  // 잔액 기반 최대 수량 및 표기용 잔액
  const [maxBalance, setMaxBalance] = useState(0);
  const [quoteBalance, setQuoteBalance] = useState(0);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  // 가격이 없고 currentPrice가 로드되었을 때 자동 채우기
  useEffect(() => {
    if (currentPrice > 0 && !price) {
      setPrice(truncateDecimals(currentPrice, PRICE_DECIMALS));
    }
  }, [currentPrice, price]);

  // 초기화 + URL ?type= 파라미터 처리
  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = '/login';
      return;
    }

    // 탭 이동 시 폼 백지상태(초기화)
    setQuantity('');
    setPrice('');

    fetchTokens();
    fetchFeeRate();
    fetchActiveOrders();
    fetchOrderHistory();

    // /trade?type=sell → side를 sell로 설정
    const type = searchParams.get('type');
    if (type === 'sell' || type === 'buy') {
      setSide(type);
    } else {
      setSide('buy');
    }
  }, [searchParams, setQuantity, setPrice, setSide, fetchTokens, fetchFeeRate, fetchActiveOrders, fetchOrderHistory]);

  // /trade?symbol=SOL → 해당 토큰 사전 선택 (개별 코인 행 딥링크)
  const symbolParam = searchParams.get('symbol');
  const appliedSymbolRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!symbolParam || tokens.length === 0) return;
    if (appliedSymbolRef.current === symbolParam) return; // 이미 이 파라미터를 적용했으면 무시 (사용자 수동 변경 허용)
    
    // 대소문자 무시 매칭 (USDT/USDC는 스테이블코인이라 거래 불가 — 제외)
    const matched = tokens.find(
      (tok) =>
        tok.symbol.toUpperCase() === symbolParam.toUpperCase() &&
        tok.symbol !== 'USDT' &&
        tok.symbol !== 'USDC',
    );
    if (matched) {
      setSelectedToken(matched);
      appliedSymbolRef.current = symbolParam;
    }
  }, [symbolParam, tokens, setSelectedToken]);

  // 토큰 선택 시 오더북 + 현재가 + 잔액 조회
  useEffect(() => {
    if (selectedToken) {
      fetchOrderbook();
      fetchCurrentPrice();
    }
  }, [selectedToken?.mint_address]);

  // 실시간 가격 자동 갱신 — 15초마다 오더북 + 현재가 폴링
  useEffect(() => {
    if (!selectedToken) return;
    const interval = setInterval(() => {
      fetchOrderbook();
      fetchCurrentPrice();
    }, 15_000);
    return () => clearInterval(interval);
  }, [selectedToken?.mint_address]);

  // 주문 상태 주기적 재조회 — 15초마다.
  // 체결은 서버의 백그라운드 폴러가 비동기로(주문 생성 후 한참 뒤에도) 감지하는데,
  // fetchOrderHistory는 마운트 시 한 번만 호출돼서 그 이후 체결은 사용자가 History
  // 탭에서 수동 새로고침하기 전까진 클라이언트가 전혀 몰랐다. 그 결과 새로 체결된
  // 주문을 감지해 자동 인출(autoWithdrawIfPossible)하는 로직이 사실상 거의 안 타서
  // 매도 대금(USDT 등)이 Manifest 잔액에 묶인 채 지갑에 안 들어오는 것처럼 보였음.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchActiveOrders();
      fetchOrderHistory();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchActiveOrders, fetchOrderHistory]);

  // 활성 지갑 잔액 조회 (최대 수량 계산용)
  const activeWallet = wallets.find((w) => w.isActive) || wallets[0];

  // Quote 통화 — 모든 거래 쌍 USDT 고정
  const quoteMint = USDT_MINT;
  const quoteSymbol = 'USDT';

  const [walletData, setWalletData] = useState<WalletBalance | null>(null);

  useEffect(() => {
    if (!activeWallet) return;

    const fetchBalance = async () => {
      setIsLoadingBalance(true);
      try {
        const bal = await getWalletBalance(activeWallet.publicKey);
        setWalletData(bal);
      } catch {
        setWalletData(null);
      } finally {
        setIsLoadingBalance(false);
      }
    };

    fetchBalance();
  }, [activeWallet?.publicKey]);

  useEffect(() => {
    if (!walletData) {
      setQuoteBalance(0);
      setTokenBalance(0);
      setMaxBalance(0);
      return;
    }

    const qBal = walletData.tokens.find((tok) => tok.mint === quoteMint);
    const quoteAmt = qBal?.balance ?? 0;
    setQuoteBalance(quoteAmt);

    let tokBal = 0;
    if (selectedToken) {
      if (selectedToken.symbol === 'SOL') {
        tokBal = walletData.sol;
      } else {
        const tokenBal = walletData.tokens.find((tok) => tok.mint === selectedToken.mint_address);
        tokBal = tokenBal?.balance ?? 0;
      }
    }
    setTokenBalance(tokBal);

    if (side === 'buy') {
      // 매수 시: 보유 Quote(USDT/USDC) 잔액 → 구매 가능한 토큰 수량
      setMaxBalance(quoteAmt > 0 && Number(price) > 0 ? quoteAmt / Number(price) : 0);
    } else {
      // 매도 시: 보유 토큰 수량
      setMaxBalance(tokBal);
    }
  }, [walletData, side, selectedToken, price, quoteMint]);

  // 지갑이 이미 잠금 해제된 세션인지 — 거래/취소는 이 경우 PIN 재입력 없이 진행
  const isWalletUnlocked = () => !!wallets.find((w) => w.isActive)?.secretKey;

  // 주문 실행 → 잠금 해제 상태면 즉시 서명/제출, 아니면 PIN 모달 표시
  const handleExecute = async (pin?: string) => {
    setPinError(null);
    try {
      const result = await createAndSubmitOrder(pin);
      setShowPinModal(false);
      setPrice('');
      setQuantity('');
      showToast(t('trade.orderSubmitted'));
      if (result.txSignature) {
        showToast(`📝 Tx: ${result.txSignature.slice(0, 8)}...`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('trade.orderFailed');
      if (showPinModal) setPinError({ msg, variant: getErrorVariant(err) });
      else showToast(msg, getErrorVariant(err));
    }
  };

  // 주문 취소 → 잠금 해제 상태면 즉시 서명/제출, 아니면 PIN 모달 표시
  const executeCancelOrder = async (orderId: string, pin?: string) => {
    setCancelPinError(null);
    try {
      const result = await cancelOrder(orderId, pin);
      setShowCancelPinModal(false);
      setPendingCancelOrderId(null);
      showToast(t('trade.orderCancelled'));
      // 취소로 풀린 자금이 지갑으로 반환된 경우 안내 (반환이 없으면 조용히 넘어감)
      if (result.withdrawnTx) {
        setTimeout(() => showToast(t('trade.cancelRefunded')), 500);
      }
    } catch (err) {
      // 서버 에러 code 기반 i18n 메시지 — 원인을 사용자가 알 수 있게
      const msg = err instanceof ApiError && err.code === 'INSUFFICIENT_SOL'
        ? t('error.cancelInsufficientSol')
        : err instanceof Error ? err.message : t('trade.cancelFailed');
      if (showCancelPinModal) setCancelPinError({ msg, variant: getErrorVariant(err) });
      else showToast(msg, getErrorVariant(err));
    }
  };

  // 수익 인출 — 잠금 해제 상태면 PIN 없이 즉시 실행, 아니면 PIN 모달 표시
  const handleWithdrawExecute = async (pin?: string) => {
    setWithdrawPinError(null);
    try {
      const result = await withdrawFunds(pin);
      setShowWithdrawPinModal(false);
      showToast(t('trade.withdrawSuccess'));
      if (result.txSignature) {
        showToast(`📝 Tx: ${result.txSignature.slice(0, 8)}...`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('trade.withdrawFailed');
      if (showWithdrawPinModal) setWithdrawPinError({ msg, variant: getErrorVariant(err) });
      else showToast(msg, getErrorVariant(err));
    }
  };

  // 유효성 검사 (isLocked 체크 제거 — unlock은 createAndSubmitOrder 내부에서 PIN으로 처리)
  const validateOrder = (): string | null => {
    if (!activeWallet) return t('val.noWallet');
    if (!selectedToken) return t('val.noToken');
    const priceNum = Number(price);
    if (!price || !isFinite(priceNum) || priceNum <= 0) return t('val.invalidPrice');
    const qtyNum = Number(quantity);
    if (!quantity || !isFinite(qtyNum) || qtyNum <= 0) return t('val.invalidAmount');
    // 최대 소수점 검사 — 가격과 수량 모두
    const decimals = selectedToken.decimals || 9;
    const checkDecimals = (val: string, label: string, maxDecimals: number) => {
      const dotIdx = val.indexOf('.');
      if (dotIdx !== -1 && val.length - dotIdx - 1 > maxDecimals) {
        return t('val.maxDecimals', { label, decimals: maxDecimals });
      }
      return null;
    };
    const priceErr = checkDecimals(String(price), t('val.price'), PRICE_DECIMALS);
    if (priceErr) return priceErr;
    const qtyErr = checkDecimals(String(quantity), selectedToken.symbol, decimals);
    if (qtyErr) return qtyErr;
    // 최대값 검사 (오버플로우 방지)
    if (priceNum > 1e12) return t('val.priceTooLarge');
    if (qtyNum > 1e12) return t('val.amountTooLarge');
    // 잔액 부족 사전 차단 (PIN 입력 전)
    const needed = priceNum * qtyNum;
    if (side === 'buy') {
      if (quoteBalance < needed) {
        return t('val.insufficientUsdt', {
          balance: quoteBalance.toFixed(6),
          required: needed.toFixed(6),
        });
      }
    } else {
      if (tokenBalance < qtyNum) {
        return t('val.insufficientToken', {
          symbol: selectedToken.symbol,
          balance: tokenBalance.toFixed(6),
        });
      }
    }
    return null;
  };

  const validationError = validateOrder();

  // 주문 금액 계산
  const priceNum = Number(price) || 0;
  const qtyNum = Number(quantity) || 0;
  const totalAmount = priceNum * qtyNum;
  const feeAmount = totalAmount * feeRate;
  const totalWithFee = totalAmount + feeAmount;

  return (
    <main className="min-h-screen p-4 pb-24">
      {/* Header */}
      <header className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-xl">←</Link>
        <h1 className="text-xl font-bold">
          {side === 'buy' ? t('trade.buyOrder') : t('trade.sellOrder')}
        </h1>
      </header>

      {/* Token Selection */}
      <section className="mb-4 relative">
        <button
          onClick={() => setShowTokenDropdown(!showTokenDropdown)}
          className="w-full bg-gray-800/50 rounded-xl px-3 py-2 flex items-center justify-between"
        >
          {selectedToken ? (
            <div className="flex items-center gap-2">
              <TokenLogo symbol={selectedToken.symbol} />
              <span className="text-sm text-gray-300">
                {selectedToken.symbol}/{quoteSymbol}
              </span>
            </div>
          ) : (
            <span className="text-sm text-gray-400">{t('trade.selectToken')}</span>
          )}
          <span className="text-xs text-gray-400">▼</span>
        </button>

        {showTokenDropdown && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl z-10 max-h-48 overflow-y-auto">
            {tokens
              .filter(
                (tok) => tok.symbol !== 'USDT' && tok.symbol !== 'USDC',
              )
              .map((token) => (
                <button
                  key={token.id}
                  onClick={() => {
                    setSelectedToken(token);
                    setShowTokenDropdown(false);
                  }}
                  className={`w-full px-3 py-2 text-left hover:bg-gray-700 flex items-center gap-2 ${
                    selectedToken?.id === token.id ? 'bg-gray-700' : ''
                  }`}
                >
                  <TokenLogo symbol={token.symbol} />
                  <span className="text-sm text-gray-300">
                    {token.symbol}/{quoteSymbol}
                  </span>
                </button>
              ))}
          </div>
        )}
      </section>

      {/* Buy/Sell Toggle */}
      <div className="flex bg-gray-800 rounded-xl p-1 mb-4">
        <button
          onClick={() => { setSide('buy'); setQuantity(''); }}
          className={`flex-1 py-2 rounded-lg text-center text-sm font-medium transition ${
            side === 'buy' ? 'bg-green-600 text-white' : 'text-gray-400'
          }`}
        >
          {t('trade.buyBtn')}
        </button>
        <button
          onClick={() => { setSide('sell'); setQuantity(''); }}
          className={`flex-1 py-2 rounded-lg text-center text-sm font-medium transition ${
            side === 'sell' ? 'bg-red-600 text-white' : 'text-gray-400'
          }`}
        >
          {t('trade.sellBtn')}
        </button>
      </div>

      {/* Order Type — 지정가 (시장가 미지원) */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        <button
          className="px-4 py-2 text-sm font-medium transition border-b-2 -mb-px border-primary-500 text-white"
        >
          {t('trade.limit')}
        </button>
      </div>

      {/* Price Input — 지정가 */}
      <section className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">{t('trade.priceLabel')}</label>
        <div className="bg-gray-800/50 rounded-xl p-4 flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(normalizePriceInput(e.target.value))}
            placeholder={t('trade.pricePlaceholder')}
            pattern="[0-9]*[.]?[0-9]{0,6}"
            className="bg-transparent flex-1 outline-none text-white placeholder-gray-500"
          />
        </div>
      </section>

      {/* Amount Input */}
      <section className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">
          {t('trade.amountLabel')}
        </label>
        <div className="bg-gray-800/50 rounded-xl p-4 mb-6 relative">
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
            min="0"
            step="any"
            className="bg-transparent w-full outline-none text-white placeholder-gray-500"
          />
        </div>

        {/* 수량 슬라이더 */}
        {(() => {
          const effectiveMax = maxBalance > 0 ? maxBalance : 1;
          const disabled = maxBalance <= 0;
          const currentRatio = Math.min((Number(quantity) || 0) / effectiveMax, 1);
          const percentage = Math.round(currentRatio * 100);
          const sliderStops = [0, ...QUICK_AMOUNT_RATIOS];
          const activeStop = sliderStops.find((ratio) => Math.abs(currentRatio - ratio) <= 0.015);
          const applyRatio = (ratio: number) => {
            const decimals = selectedToken?.decimals || 6;
            const actualMax = maxBalance > 0 ? maxBalance : 0;
            const snappedRatio = ratio >= 0.985 ? 1 : ratio;
            const val = Number((actualMax * snappedRatio).toFixed(decimals));
            setQuantity(String(val));
          };

          return (
          <div className={`mb-6 px-1 ${disabled ? 'opacity-50' : ''}`}>
            <div className="relative" style={{ height: '34px' }}>
              {/* Background Track */}
              <div className="absolute top-1/2 left-0 right-0 h-1 bg-gray-700 -translate-y-1/2 rounded-full" />
              {/* Fill Track — 드래그 정도에 따라 색상 그라데이션 (시안 → 보라) */}
              <div
                className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full transition-all"
                style={{
                  width: `${currentRatio * 100}%`,
                  background: `linear-gradient(to right, #06b6d4 ${Math.min(currentRatio * 133, 100)}%, #6366f1 100%)`,
                  boxShadow: currentRatio > 0 ? '0 0 6px rgba(99, 102, 241, 0.5)' : 'none',
                }}
              />

              {/* Tooltip for percentage */}
              <div
                className="absolute -top-8 -translate-x-1/2 text-[13px] font-bold text-white bg-primary-500 px-2 py-0.5 rounded shadow-lg pointer-events-none transition-all z-40"
                style={{ left: `${currentRatio * 100}%`, opacity: percentage > 0 ? 1 : 0 }}
              >
                {percentage}%
              </div>

              {/* Custom Thumb for current value */}
              <div
                className="absolute top-1/2 w-5 h-5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.8),0_0_15px_rgba(99,102,241,0.8)] -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none"
                style={{
                  left: `${currentRatio * 100}%`,
                }}
              />

              {/* Slider Markers — keep fixed stops below the draggable thumb. */}
              <div className="absolute inset-x-0 top-1/2 flex items-center z-30 pointer-events-none">
                {sliderStops.map((ratio) => {
                  const isActive = (Number(quantity) || 0) >= effectiveMax * ratio - effectiveMax * 0.01;
                  return (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => applyRatio(ratio)}
                      className="absolute flex w-10 h-10 items-center justify-center rounded-full cursor-pointer pointer-events-auto touch-manipulation"
                      style={{
                        left: `${ratio * 100}%`,
                        transform: 'translate(-50%, 6px)',
                      }}
                      aria-label={`${Math.round(ratio * 100)}%`}
                    >
                      <span
                        className={`block w-3.5 h-3.5 rounded-full border-2 border-gray-900 shadow-md transition-all duration-200 ${
                          isActive
                            ? 'bg-white'
                            : 'bg-gray-400'
                        }`}
                        style={{
                          boxShadow: isActive
                            ? '0 0 8px rgba(255, 255, 255, 0.9), 0 0 14px rgba(99, 102, 241, 0.6)'
                            : 'none',
                        }}
                      />
                    </button>
                  );
                })}
              </div>
              
              {/* Range Input: 투명하게 덮어서 전체 영역에서 드래그 가능하도록 함 */}
              <input
                type="range"
                min={0}
                max={effectiveMax}
                step={effectiveMax / 100}
                value={Math.min(Number(quantity) || 0, effectiveMax)}
                disabled={disabled}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  const ratio = val / effectiveMax;
                  applyRatio(ratio);
                }}
                className="slider-markers absolute inset-0 w-full cursor-pointer z-50 opacity-0"
              />
            </div>
            {/* Min/Max Labels */}
            <div className="flex justify-between mt-2">
              {sliderStops.map((ratio) => {
                const isActiveLabel = activeStop === ratio;
                return (
                  <span
                    key={ratio}
                    className={`text-[13px] font-medium transition-all duration-200 ${
                      isActiveLabel
                        ? 'scale-125 text-primary-300'
                        : 'scale-100 text-gray-500'
                    }`}
                  >
                    {Math.round(ratio * 100)}%
                  </span>
                );
              })}
            </div>
          </div>
          );
        })()}
      </section>

      {/* Total Section */}
      <section className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">{t('trade.totalLabel')}</label>
        <div className="bg-gray-800/50 rounded-xl p-4 flex justify-between items-center">
          <span className="text-white">{totalAmount > 0 ? totalAmount.toFixed(4) : '0'}</span>
          <span className="text-gray-400 text-sm">{quoteSymbol}</span>
        </div>
      </section>

      {/* Available & Max Buy */}
      <section className="mb-6 space-y-2 px-1">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">{t('trade.available')}</span>
          <span className="font-medium text-white">{side === 'buy' ? quoteBalance.toFixed(6) : tokenBalance.toFixed(6)} {side === 'buy' ? quoteSymbol : selectedToken?.symbol}</span>
        </div>
        {side === 'buy' && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">{t('trade.maxBuy')}</span>
            <span className="font-medium text-white">{maxBalance > 0 ? maxBalance.toFixed(4) : '0.0000'} {selectedToken?.symbol}</span>
          </div>
        )}
      </section>

      {/* Execute Button */}
      <button
        onClick={() => {
          if (validationError) {
            showToast(validationError);
            return;
          }
          if (isWalletUnlocked()) {
            handleExecute();
          } else {
            setShowPinModal(true);
          }
        }}
        disabled={isSubmitting || !activeWallet}
        className={`w-full py-4 rounded-xl font-bold text-lg transition disabled:opacity-50 ${
          side === 'buy'
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-red-600 hover:bg-red-700 text-white'
        }`}
      >
        {isSubmitting
          ? t('common.processing')
          : t('trade.submitOrder', { side: side === 'buy' ? t('trade.buyBtn') : t('trade.sellBtn'), symbol: selectedToken?.symbol ?? '' })}
      </button>

      {/* Orders Tabs — Open Orders / History */}
      <section className="mt-6">
        {/* Tab Header */}
        <div className="flex items-center justify-between border-b border-gray-800 mb-3">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('open')}
              className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
                activeTab === 'open'
                  ? 'border-primary-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t('trade.openOrders')}
              {activeOrders.length > 0 && (
                <span className="ml-1.5 text-gray-500">({activeOrders.length})</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
                activeTab === 'history'
                  ? 'border-primary-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t('trade.history')}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (isWalletUnlocked()) {
                  handleWithdrawExecute();
                } else {
                  setShowWithdrawPinModal(true);
                }
              }}
              className="p-1.5 rounded-lg bg-primary-500/10 text-primary-400 hover:bg-primary-500/20 transition"
              aria-label={t('trade.withdraw')}
              title={t('trade.withdraw')}
            >
              <ArrowDownToLine className="w-4 h-4" />
            </button>
            <button
              onClick={() => activeTab === 'open' ? fetchActiveOrders() : fetchOrderHistory()}
              className="p-1 text-gray-400 hover:text-white transition"
              aria-label={t('trade.refresh')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab: Open Orders */}
        {activeTab === 'open' && (
          <>
            {activeOrders.length === 0 ? (
              <p className="text-sm text-gray-400">{t('trade.noOpenOrders')}</p>
            ) : (
              <div className="space-y-2">
                {activeOrders.map((order) => {
                  const solBalance = walletData?.sol ?? 0;
                  const canCancel = solBalance >= 0.0005;
                  return (
                  <div key={order.id} className="bg-gray-800/50 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          order.side === 'buy' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                        }`}>
                          {order.side === 'buy' ? t('trade.buyTag') : t('trade.sellTag')}
                        </span>
                        <span className="font-medium text-sm">{order.tokenSymbol}</span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {order.price} × {order.quantity}
                      </p>
                    </div>
                    {canCancel ? (
                      <button
                        onClick={() => {
                          if (isWalletUnlocked()) {
                            executeCancelOrder(order.id);
                          } else {
                            setPendingCancelOrderId(order.id);
                            setCancelPinError(null);
                            setShowCancelPinModal(true);
                          }
                        }}
                        className="text-xs px-3 py-1 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition"
                      >
                        {t('trade.cancel')}
                      </button>
                    ) : (
                      <span className="text-xs px-3 py-1 rounded-lg bg-gray-700/50 text-gray-500 cursor-not-allowed" title={t('error.cancelInsufficientSol')}>
                        {t('trade.cancel')}
                      </span>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Tab: History */}
        {activeTab === 'history' && (
          <>
            {orderHistory.length === 0 ? (
              <p className="text-sm text-gray-400">{t('trade.noHistory')}</p>
            ) : (
              <div className="space-y-2">
                {orderHistory.map((order) => {
                  const statusLabel = order.status === 'filled' ? t('trade.statusFilled')
                    : order.status === 'cancelled' ? t('trade.statusCancelled')
                    : order.status === 'failed' ? t('trade.statusFailed')
                    : order.status === 'expired' ? t('trade.statusExpired')
                    : order.status;
                  // 실패/만료는 tx가 없으면 전송 실패(주황), tx가 있으면 체인 오류(빨강)
                  const isFailed = order.status === 'failed' || order.status === 'expired';
                  const isSoftFail = isFailed && !order.txSignature;
                  const statusColor = order.status === 'filled' ? 'text-blue-400 bg-blue-600/20'
                    : order.status === 'cancelled' ? 'text-gray-400 bg-gray-600/20'
                    : isSoftFail ? 'text-amber-400 bg-amber-600/20'
                    : isFailed ? 'text-red-400 bg-red-600/20'
                    : 'text-gray-400 bg-gray-600/20';
                  return (
                    <div key={order.id} className="bg-gray-800/50 rounded-xl p-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          order.side === 'buy' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                        }`}>
                          {order.side === 'buy' ? t('trade.buyTag') : t('trade.sellTag')}
                        </span>
                        <span className="font-medium text-sm">{order.tokenSymbol}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {order.price} × {order.quantity}
                        <span className="ml-2">{new Date(order.created_at).toLocaleDateString()}</span>
                      </p>

                      {/* 주문 tx / 취소 tx를 각각 표시 — 취소된 주문도 원래 주문 tx를 함께 확인 가능 */}
                      {(order.txSignature || order.cancelTxSignature) && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                          {order.txSignature && (
                            <a
                              href={`https://solscan.io/tx/${order.txSignature}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] font-mono text-primary-400 hover:text-primary-300 transition"
                            >
                              {t('trade.orderTx')} {order.txSignature.slice(0, 6)}...{order.txSignature.slice(-4)} ↗
                            </a>
                          )}
                          {order.cancelTxSignature && (
                            <a
                              href={`https://solscan.io/tx/${order.cancelTxSignature}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] font-mono text-red-400 hover:text-red-300 transition"
                            >
                              {t('trade.cancelTx')} {order.cancelTxSignature.slice(0, 6)}...{order.cancelTxSignature.slice(-4)} ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* 무한 스크롤 sentinel + 로딩 인디케이터 */}
                {historyHasMore && (
                  <div ref={sentinelRef} className="py-3 text-center">
                    {isLoadingMoreHistory && (
                      <span className="text-xs text-gray-500">{t('common.loading')}</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Orderbook Display */}
      {orderbook && (orderbook.bids.length > 0 || orderbook.asks.length > 0) && (
        <section className="mt-6">
          <h2 className="text-lg font-bold mb-3">{t('trade.orderbook')}</h2>
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Bids */}
              <div>
                <p className="text-[10.8px] text-green-400 mb-2 font-medium">{t('trade.bids')}</p>
                <div className="space-y-1">
                  {orderbook.bids.slice(0, 5).map((bid, i) => (
                    <div key={i} className="flex justify-between text-[10.8px]">
                      <span className="text-green-400">
                        <span className="max-xs:hidden">{truncateDecimals(bid.price, 8)}</span>
                        <span className="hidden max-xs:inline">{bid.price.toFixed(8)}…</span>
                      </span>
                      <span className="text-gray-400">{bid.quantity.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Asks */}
              <div>
                <p className="text-[10.8px] text-red-400 mb-2 font-medium">{t('trade.asks')}</p>
                <div className="space-y-1">
                  {orderbook.asks.slice(0, 5).map((ask, i) => (
                    <div key={i} className="flex justify-between text-[10.8px]">
                      <span className="text-red-400">
                        <span className="max-xs:hidden">{truncateDecimals(ask.price, 8)}</span>
                        <span className="hidden max-xs:inline">{ask.price.toFixed(8)}…</span>
                      </span>
                      <span className="text-gray-400">{ask.quantity.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Bottom Nav */}
      <BottomNav />

      {/* PIN Modal for signing */}
      <PinModal
        isOpen={showPinModal}
        title={t('trade.pinTitle')}
        subtitle={t('trade.pinSubtitle')}
        onConfirm={handleExecute}
        onCancel={() => {
          setShowPinModal(false);
          setPinError(null);
        }}
        error={pinError?.msg}
        errorVariant={pinError?.variant}
      />

      {/* PIN Modal for cancel signing */}
      <PinModal
        isOpen={showCancelPinModal}
        title={t('trade.pinTitle')}
        subtitle={t('trade.pinSubtitle')}
        onConfirm={(pin) => {
          if (!pendingCancelOrderId) return Promise.resolve();
          return executeCancelOrder(pendingCancelOrderId, pin);
        }}
        onCancel={() => {
          setShowCancelPinModal(false);
          setPendingCancelOrderId(null);
          setCancelPinError(null);
        }}
        error={cancelPinError?.msg}
        errorVariant={cancelPinError?.variant}
      />

      {/* PIN Modal for withdraw signing */}
      <PinModal
        isOpen={showWithdrawPinModal}
        title={t('trade.withdraw')}
        subtitle={t('trade.pinSubtitle')}
        onConfirm={handleWithdrawExecute}
        onCancel={() => {
          setShowWithdrawPinModal(false);
          setWithdrawPinError(null);
        }}
        error={withdrawPinError?.msg}
        errorVariant={withdrawPinError?.variant}
      />
    </main>
  );
}

export default function TradePage() {
  const { t } = useT();
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">{t('common.loading')}</div>}>
      <TradeContent />
    </Suspense>
  );
}
