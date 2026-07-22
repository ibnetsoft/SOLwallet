'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTradeStore } from '@/stores/useTradeStore';
import { useWalletStore } from '@/stores/useWalletStore';
import { useToast } from '@/components/Toast';
import PinModal from '@/components/PinModal';
import { BottomNav } from '@/components/BottomNav';
import { SkeletonCard } from '@/components/Skeleton';
import { FEE_RATE, QUICK_AMOUNT_RATIOS, USDT_MINT } from '@solwallet/config';
import { getWalletBalance } from '@/lib/api/balance';
import { isLoggedIn } from '@/lib/api/auth';
import { useT } from '@/lib/i18n';

function TradeContent() {
  const { t } = useT();
  const {
    side, setSide,
    orderType, setOrderType,
    selectedToken, setSelectedToken,
    price, setPrice,
    quantity, setQuantity,
    currentPrice,
    orderbook,
    tokens,
    activeOrders,
    orderHistory,
    historyHasMore,
    historyCursor,
    isLoadingMoreHistory,
    isSubmitting,
    fetchTokens,
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

  // 잔액 기반 최대 수량
  const [maxBalance, setMaxBalance] = useState(0);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  // 초기화 + URL ?type= 파라미터 처리
  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = '/login';
      return;
    }
    fetchTokens();
    fetchActiveOrders();
    fetchOrderHistory();

    // /trade?type=sell → side를 sell로 설정
    const type = searchParams.get('type');
    if (type === 'sell' || type === 'buy') {
      setSide(type);
    }
  }, [searchParams]);

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

  useEffect(() => {
    if (!activeWallet) return;

    const fetchMaxBalance = async () => {
      setIsLoadingBalance(true);
      try {
        const bal = await getWalletBalance(activeWallet.publicKey);
        if (side === 'buy') {
          // 매수 시: 보유 USDT 잔액 → 구매 가능한 토큰 수량
          const usdtBal = bal.tokens.find((tok) => tok.mint === USDT_MINT);
          const usdt = usdtBal?.balance ?? 0;
          setMaxBalance(usdt > 0 && Number(price) > 0 ? usdt / Number(price) : 0);
        } else {
          // 매도 시: 보유 토큰 수량
          if (selectedToken) {
            const tokenBal = bal.tokens.find((tok) => tok.mint === selectedToken.mint_address);
            setMaxBalance(tokenBal?.balance ?? 0);
          } else {
            setMaxBalance(0);
          }
        }
      } catch {
        setMaxBalance(0);
      } finally {
        setIsLoadingBalance(false);
      }
    };

    fetchMaxBalance();
  }, [activeWallet, side, selectedToken, price]);

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
  const feeAmount = totalAmount * FEE_RATE;
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

      {/* Token Selection */}
      <section className="mb-4 relative">
        <label className="text-sm text-gray-400 mb-1 block">{t('trade.tokenSelect')}</label>
        <button
          onClick={() => setShowTokenDropdown(!showTokenDropdown)}
          className="w-full bg-gray-800/50 rounded-xl p-4 flex items-center justify-between"
        >
          <div>
            <p className="font-medium">{selectedToken ? selectedToken.symbol : t('trade.selectToken')}</p>
            <p className="text-sm text-gray-400">
              {selectedToken ? `${selectedToken.symbol}/USDT` : t('trade.baseCurrency')}
            </p>
          </div>
          <span className="text-gray-400">▼</span>
        </button>

        {showTokenDropdown && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl z-10 max-h-48 overflow-y-auto">
            {tokens
              .filter((tok) => tok.symbol !== 'USDT')
              .map((token) => (
                <button
                  key={token.id}
                  onClick={() => {
                    setSelectedToken(token);
                    setShowTokenDropdown(false);
                  }}
                  className={`w-full px-4 py-3 text-left hover:bg-gray-700 flex justify-between ${
                    selectedToken?.id === token.id ? 'bg-gray-700' : ''
                  }`}
                >
                  <span className="font-medium">{token.symbol}</span>
                  <span className="text-xs text-gray-400">{token.mint_address.slice(0, 4)}...</span>
                </button>
              ))}
          </div>
        )}
      </section>

      {/* Price Input — 지정가일 때만 표시 */}
      {orderType === 'limit' ? (
        <section className="mb-4">
          <label className="text-sm text-gray-400 mb-1 block">{t('trade.limitPrice')}</label>
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
            <button
              onClick={applyCurrentPrice}
              disabled={currentPrice === 0}
              className="bg-gray-700 text-xs px-2 py-1 rounded disabled:opacity-50 hover:bg-gray-600 transition"
            >
              {t('trade.currentPrice')}
            </button>
          </div>
          {currentPrice > 0 && (
            <p className="text-xs text-gray-500 mt-1">{t('trade.currentPriceLabel')} {currentPrice.toFixed(4)} USDT</p>
          )}
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
          {t('trade.amount')}
          {maxBalance > 0 && (
            <span className="text-primary-400 ml-2">
              {t('trade.holding')}: {maxBalance.toFixed(4)})
            </span>
          )}
        </label>
        <div className="bg-gray-800/50 rounded-xl p-4">
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={t('trade.amountPlaceholder')}
            min="0"
            step="any"
            className="bg-transparent w-full outline-none text-white placeholder-gray-500 mb-3"
          />

          {/* 수량 슬라이더 — 드래그로 수량 선택 (maxBalance 기준, 25% 단위 스냅) */}
          {(() => {
            // 잔고가 없어도 슬라이더는 표시. 잔고 0일 때는 1을 기준으로 표시만 하고 비활성화
            const effectiveMax = maxBalance > 0 ? maxBalance : 1;
            const disabled = maxBalance <= 0;
            return (
            <div className={`mb-3 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
              {/* 슬라이더 + 마커를 같은 박스에 겹쳐 배치 — 트랙 중앙에 마커 정렬 */}
              <div className="relative" style={{ height: '22px' }}>
                {/* 25% 단위 굵직한 마커 — 트랙 위에 겹침, 클릭 시 해당 비율로 이동 */}
                <div className="absolute inset-x-0 inset-y-0 flex items-center z-20 pointer-events-auto">
                  {QUICK_AMOUNT_RATIOS.map((ratio) => {
                    const isActive = (Number(quantity) || 0) >= effectiveMax * ratio - effectiveMax * 0.01;
                    return (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => {
                          if (disabled) return;
                          const decimals = selectedToken?.decimals || 6;
                          const val = Number((effectiveMax * ratio).toFixed(decimals));
                          setQuantity(String(val));
                        }}
                        className={`absolute -translate-x-1/2 block w-4 h-4 rounded-full border-2 border-gray-800 shadow-md transition-colors cursor-pointer ${
                          isActive ? 'bg-primary-500' : 'bg-gray-500 hover:bg-gray-400'
                        }`}
                        style={{ left: `${ratio * 100}%` }}
                        aria-label={`${Math.round(ratio * 100)}%`}
                      />
                    );
                  })}
                </div>
                <input
                  type="range"
                  min={0}
                  max={effectiveMax}
                  step={effectiveMax / 4}
                  value={Math.min(Number(quantity) || 0, effectiveMax)}
                  disabled={disabled}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    // 유효 자릿수로 반올림하여 표시 (불필요한 소수점 방지)
                    const decimals = selectedToken?.decimals || 6;
                    const rounded = Number(val.toFixed(decimals));
                    setQuantity(String(rounded));
                  }}
                  className="slider-markers absolute inset-0 w-full cursor-pointer"
                  aria-label={t('trade.amountSlider')}
                />
              </div>
              {/* 텍스트 라벨 (25% 간격) */}
              <div className="flex justify-between mt-2 px-1">
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                  <span key={ratio} className="text-[10px] text-gray-500">
                    {Math.round(ratio * 100)}%
                  </span>
                ))}
              </div>
            </div>
            );
          })()}
        </div>
      </section>

      {/* Order Summary */}
      {priceNum > 0 && qtyNum > 0 && (
        <section className="bg-gray-800/50 rounded-xl p-4 mb-6 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">{t('trade.orderAmount')}</span>
            <span>${totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">{t('trade.fee')} ({FEE_RATE * 100}%)</span>
            <span>${feeAmount.toFixed(2)}</span>
          </div>
          <hr className="border-gray-700" />
          <div className="flex justify-between font-medium">
            <span>{t('trade.totalPay', { side: side === 'buy' ? t('trade.pay') : t('trade.receive') })}</span>
            <span>${totalWithFee.toFixed(2)}</span>
          </div>
        </section>
      )}

      {/* Execute Button */}
      <button
        onClick={() => {
          if (validationError) {
            showToast(validationError);
            return;
          }
          setShowPinModal(true);
        }}
        disabled={isSubmitting || !activeWallet || !!validationError}
        className={`w-full py-4 rounded-xl font-bold text-lg transition disabled:opacity-50 ${
          side === 'buy'
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-red-600 hover:bg-red-700 text-white'
        }`}
      >
        {isSubmitting
          ? t('common.processing')
          : t('trade.submitOrder', { side: side === 'buy' ? 'Buy' : 'Sell', type: orderType === 'limit' ? 'Limit' : 'Market' })}
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
                <span className="ml-1.5 text-xs text-gray-500">{activeOrders.length}</span>
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
            className="text-xs text-gray-400 hover:text-white transition"
          >
            {t('trade.refresh')}
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