'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useTradeStore } from '@/stores/useTradeStore';
import { useWalletStore } from '@/stores/useWalletStore';
import { useToast } from '@/components/Toast';
import PinModal from '@/components/PinModal';
import { BottomNav } from '@/components/BottomNav';
import { SkeletonCard } from '@/components/Skeleton';
import { QUICK_AMOUNT_RATIOS, USDT_MINT, USDC_MINT } from '@solwallet/config';
import { getWalletBalance, type WalletBalance } from '@/lib/api/balance';
import { isLoggedIn } from '@/lib/api/auth';
import { getTokenLogoUrl } from '@/lib/tokenLogo';
import { useT } from '@/lib/i18n';

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

function TradeContent() {
  const { t } = useT();
  const {
    side, setSide,
    orderType, setOrderType,
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
  } = useTradeStore();

  const { wallets } = useWalletStore();
  const { showToast } = useToast();
  const searchParams = useSearchParams();

  const [showPinModal, setShowPinModal] = useState(false);
  const [pinError, setPinError] = useState('');
  const [showTokenDropdown, setShowTokenDropdown] = useState(false);
  const [showCancelPinModal, setShowCancelPinModal] = useState(false);
  const [cancelPinError, setCancelPinError] = useState('');
  const [pendingCancelOrderId, setPendingCancelOrderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'open' | 'history'>('open');

  // 무한 스크롤 — History 탭에서 sentinel이 보이면 다음 페이지 로드
  const sentinelRef = useRef<HTMLDivElement>(null);
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

  // 가격이 없고 currentPrice가 로드되었을 때 지정가 자동 채우기
  useEffect(() => {
    if (orderType === 'limit' && currentPrice > 0 && !price) {
      setPrice(currentPrice.toString());
    }
  }, [currentPrice, orderType]);

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
  useEffect(() => {
    if (!symbolParam || tokens.length === 0) return;
    // 대소문자 무시 매칭 (USDT/USDC는 스테이블코인이라 거래 불가 — 제외)
    const matched = tokens.find(
      (tok) =>
        tok.symbol.toUpperCase() === symbolParam.toUpperCase() &&
        tok.symbol !== 'USDT' &&
        tok.symbol !== 'USDC',
    );
    if (matched && matched.id !== selectedToken?.id) {
      setSelectedToken(matched);
    }
  }, [symbolParam, tokens, selectedToken, setSelectedToken]);

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

  // 활성 지갑 잔액 조회 (최대 수량 계산용)
  const activeWallet = wallets.find((w) => w.isActive) || wallets[0];

  // 현재 선택된 토큰의 Quote 통화 결정 (SOL은 USDC, 나머지는 USDT로 임시 매핑. 추후 토큰 속성에 따라 변경 가능)
  const isUsdcQuote = selectedToken?.symbol === 'SOL';
  const quoteMint = isUsdcQuote ? USDC_MINT : USDT_MINT;
  const quoteSymbol = isUsdcQuote ? 'USDC' : 'USDT';

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

  // 주문 실행 → PIN 입력 → 서명 + 제출
  const handleExecute = async (pin: string) => {
    setPinError('');
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
      setPinError(err instanceof Error ? err.message : t('trade.orderFailed'));
    }
  };

  // 주문 취소 → PIN 입력 → 서명 + 제출
  const handleCancelExecute = async (pin: string) => {
    if (!pendingCancelOrderId) return;
    setCancelPinError('');
    try {
      await cancelOrder(pendingCancelOrderId, pin);
      setShowCancelPinModal(false);
      setPendingCancelOrderId(null);
      showToast(t('trade.orderCancelled'));
    } catch (err) {
      setCancelPinError(err instanceof Error ? err.message : t('trade.cancelFailed'));
    }
  };

  // 유효성 검사 (isLocked 체크 제거 — unlock은 createAndSubmitOrder 내부에서 PIN으로 처리)
  const validateOrder = (): string | null => {
    if (!activeWallet) return t('val.noWallet');
    if (!selectedToken) return t('val.noToken');
    // 시장가일 때 오더북 없으면 차단
    if (orderType === 'market' && currentPrice <= 0) {
      return t('val.noMarketPrice');
    }
    const priceNum = Number(price);
    if (!price || !isFinite(priceNum) || priceNum <= 0) return t('val.invalidPrice');
    const qtyNum = Number(quantity);
    if (!quantity || !isFinite(qtyNum) || qtyNum <= 0) return t('val.invalidAmount');
    // 최대 소수점 검사 — 가격과 수량 모두
    const decimals = selectedToken.decimals || 9;
    const checkDecimals = (val: string, label: string) => {
      const dotIdx = val.indexOf('.');
      if (dotIdx !== -1 && val.length - dotIdx - 1 > decimals) {
        return t('val.maxDecimals', { label, decimals });
      }
      return null;
    };
    const priceErr = checkDecimals(String(price), t('val.price'));
    if (priceErr) return priceErr;
    const qtyErr = checkDecimals(String(quantity), selectedToken.symbol);
    if (qtyErr) return qtyErr;
    // 최대값 검사 (오버플로우 방지)
    if (priceNum > 1e12) return t('val.priceTooLarge');
    if (qtyNum > 1e12) return t('val.amountTooLarge');
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

      {/* Order Type Tab — 지정가 / 시장가 */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {(['limit', 'market'] as const).map((ot) => (
          <button
            key={ot}
            onClick={() => setOrderType(ot)}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
              orderType === ot
                ? 'border-primary-500 text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {ot === 'limit' ? t('trade.limit') : t('trade.market')}
          </button>
        ))}
      </div>

      {/* Price Input — 지정가일 때만 표시 */}
      {orderType === 'limit' ? (
        <section className="mb-4">
          <label className="text-sm text-gray-400 mb-1 block">Price</label>
          <div className="bg-gray-800/50 rounded-xl p-4 flex items-center gap-2">
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={t('trade.pricePlaceholder')}
              min="0"
              step="any"
              className="bg-transparent flex-1 outline-none text-white placeholder-gray-500"
            />
          </div>
        </section>
      ) : (
        <section className="mb-4">
          <label className="text-sm text-gray-400 mb-1 block">{t('trade.marketPrice')}</label>
          <div className="bg-gray-800/30 rounded-xl p-4 flex items-center justify-between border border-dashed border-gray-700">
            <span className="text-sm text-gray-400">
              {currentPrice > 0
                ? t('trade.marketExec')
                : t('trade.loadingPrice')}
            </span>
            <span className="text-sm font-medium tabular-nums">
              {currentPrice > 0 ? `${currentPrice.toFixed(4)} USDT` : '-'}
            </span>
          </div>
        </section>
      )}

      {/* Amount Input */}
      <section className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">
          Amount
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

          return (
          <div className={`mb-6 px-1 ${disabled ? 'opacity-50' : ''}`}>
            <div className="relative" style={{ height: '22px' }}>
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
                className="absolute -top-7 -translate-x-1/2 text-[10px] font-bold text-white bg-primary-500 px-1.5 py-0.5 rounded shadow-lg pointer-events-none transition-all z-40"
                style={{ left: `${currentRatio * 100}%`, opacity: percentage > 0 ? 1 : 0 }}
              >
                {percentage}%
              </div>

              {/* Custom Thumb for current value */}
              <div
                className="absolute top-1/2 w-5 h-5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.8),0_0_15px_rgba(99,102,241,0.8)] -translate-x-1/2 -translate-y-1/2 z-35 pointer-events-none"
                style={{
                  left: `${currentRatio * 100}%`,
                }}
              />

              {/* Slider Markers — 0% 포함 모든 마커 (pointer-events-none으로 감싸고 버튼만 auto) */}
              <div className="absolute inset-x-0 inset-y-0 flex items-center z-40 pointer-events-none">
                {[0, ...QUICK_AMOUNT_RATIOS].map((ratio) => {
                  const isActive = (Number(quantity) || 0) >= effectiveMax * ratio - effectiveMax * 0.01;
                  return (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => {
                        const decimals = selectedToken?.decimals || 6;
                        const actualMax = maxBalance > 0 ? maxBalance : 0;
                        const val = Number((actualMax * ratio).toFixed(decimals));
                        setQuantity(String(val));
                      }}
                      className={`absolute -translate-x-1/2 block w-4 h-4 rounded-full border-2 border-gray-900 shadow-md transition-all duration-200 cursor-pointer pointer-events-auto ${
                        isActive
                          ? 'bg-white scale-110'
                          : 'bg-gray-400'
                      }`}
                      style={{
                        left: `${ratio * 100}%`,
                        boxShadow: isActive
                          ? '0 0 8px rgba(255, 255, 255, 0.9), 0 0 14px rgba(99, 102, 241, 0.6)'
                          : 'none',
                      }}
                      aria-label={`${Math.round(ratio * 100)}%`}
                    />
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
                  const decimals = selectedToken?.decimals || 6;
                  const ratio = val / effectiveMax;
                  const actualMax = maxBalance > 0 ? maxBalance : 0;
                  const rounded = Number((actualMax * ratio).toFixed(decimals));
                  setQuantity(String(rounded));
                }}
                className="slider-markers absolute inset-0 w-full cursor-pointer z-50 opacity-0"
              />
            </div>
            {/* Min/Max Labels */}
            <div className="flex justify-between mt-2">
              <span className="text-[11px] text-gray-500 font-medium">0%</span>
              <span className="text-[11px] text-gray-500 font-medium">100%</span>
            </div>
          </div>
          );
        })()}
      </section>

      {/* Total Section */}
      <section className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">Total</label>
        <div className="bg-gray-800/50 rounded-xl p-4 flex justify-between items-center">
          <span className="text-white">{totalAmount > 0 ? totalAmount.toFixed(4) : '0'}</span>
          <span className="text-gray-400 text-sm">{quoteSymbol}</span>
        </div>
      </section>

      {/* Available & Max Buy */}
      <section className="mb-6 space-y-2 px-1">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Available</span>
          <span className="font-medium text-white">{side === 'buy' ? quoteBalance.toFixed(6) : tokenBalance.toFixed(6)} {side === 'buy' ? quoteSymbol : selectedToken?.symbol}</span>
        </div>
        {side === 'buy' && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Max Buy</span>
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
          setShowPinModal(true);
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
          : t('trade.submitOrder', { side: side === 'buy' ? 'Buy' : 'Sell', symbol: selectedToken?.symbol ?? '' })}
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
          <button
            onClick={() => activeTab === 'open' ? fetchActiveOrders() : fetchOrderHistory()}
            className="p-1 text-gray-400 hover:text-white transition"
            aria-label={t('trade.refresh')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Tab: Open Orders */}
        {activeTab === 'open' && (
          <>
            {activeOrders.length === 0 ? (
              <p className="text-sm text-gray-400">{t('trade.noOpenOrders')}</p>
            ) : (
              <div className="space-y-2">
                {activeOrders.map((order) => (
                  <div key={order.id} className="bg-gray-800/50 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          order.side === 'buy' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                        }`}>
                          {order.side === 'buy' ? 'BUY' : 'SELL'}
                        </span>
                        <span className="font-medium text-sm">{order.tokenSymbol}</span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {order.price} × {order.quantity}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setPendingCancelOrderId(order.id);
                        setCancelPinError('');
                        setShowCancelPinModal(true);
                      }}
                      className="text-xs px-3 py-1 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition"
                    >
                      {t('trade.cancel')}
                    </button>
                  </div>
                ))}
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
                  const statusColor = order.status === 'filled' ? 'text-blue-400 bg-blue-600/20'
                    : order.status === 'cancelled' ? 'text-gray-400 bg-gray-600/20'
                    : order.status === 'failed' ? 'text-red-400 bg-red-600/20'
                    : 'text-gray-400 bg-gray-600/20';
                  return (
                    <div key={order.id} className="bg-gray-800/50 rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            order.side === 'buy' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                          }`}>
                            {order.side === 'buy' ? 'BUY' : 'SELL'}
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
                      </div>
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
                <p className="text-xs text-green-400 mb-2 font-medium">{t('trade.bids')}</p>
                <div className="space-y-1">
                  {orderbook.bids.slice(0, 5).map((bid, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-green-400">{bid.price.toFixed(4)}</span>
                      <span className="text-gray-400">{bid.quantity.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Asks */}
              <div>
                <p className="text-xs text-red-400 mb-2 font-medium">{t('trade.asks')}</p>
                <div className="space-y-1">
                  {orderbook.asks.slice(0, 5).map((ask, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-red-400">{ask.price.toFixed(4)}</span>
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
          setPinError('');
        }}
        error={pinError}
      />

      {/* PIN Modal for cancel signing */}
      <PinModal
        isOpen={showCancelPinModal}
        title={t('trade.pinTitle')}
        subtitle={t('trade.pinSubtitle')}
        onConfirm={handleCancelExecute}
        onCancel={() => {
          setShowCancelPinModal(false);
          setPendingCancelOrderId(null);
          setCancelPinError('');
        }}
        error={cancelPinError}
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