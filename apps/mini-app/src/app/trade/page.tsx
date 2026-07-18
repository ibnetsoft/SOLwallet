'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTradeStore } from '@/stores/useTradeStore';
import { useWalletStore } from '@/stores/useWalletStore';
import { useToast } from '@/components/Toast';
import PinModal from '@/components/PinModal';
import { BottomNav } from '@/components/BottomNav';
import { SkeletonCard } from '@/components/Skeleton';
import { FEE_RATE, QUICK_AMOUNT_RATIOS } from '@solwallet/config';
import { getWalletBalance } from '@/lib/api/balance';
import { isLoggedIn } from '@/lib/api/auth';

function TradeContent() {
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
    isSubmitting,
    fetchTokens,
    fetchOrderbook,
    fetchCurrentPrice,
    fetchActiveOrders,
    applyQuickRatio,
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
          // 매수 시: 보유 USDT 잔액 (TODO: USDT 전용 조회)
          setMaxBalance(bal.sol > 0 ? bal.sol / (Number(price) || 1) : 0);
        } else {
          // 매도 시: 보유 토큰 수량
          if (selectedToken) {
            const tokenBal = bal.tokens.find((t) => t.mint === selectedToken.mint_address);
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
      showToast('✅ 주문이 제출되었습니다!');
      if (result.txSignature) {
        showToast(`📝 Tx: ${result.txSignature.slice(0, 8)}...`);
      }
    } catch (err) {
      setPinError(err instanceof Error ? err.message : '주문 실패');
    }
  };

  // 유효성 검사 (isLocked 체크 제거 — unlock은 createAndSubmitOrder 내부에서 PIN으로 처리)
  const validateOrder = (): string | null => {
    if (!activeWallet) return '⚠️ 먼저 지갑을 생성해주세요.';
    if (!selectedToken) return '⚠️ 토큰을 선택해주세요.';
    // 시장가일 때 오더북 없으면 차단
    if (orderType === 'market' && currentPrice <= 0) {
      return '⚠️ 현재가 정보가 없어 시장가 주문이 불가능합니다.';
    }
    const priceNum = Number(price);
    if (!price || !isFinite(priceNum) || priceNum <= 0) return '⚠️ 올바른 가격을 입력해주세요.';
    const qtyNum = Number(quantity);
    if (!quantity || !isFinite(qtyNum) || qtyNum <= 0) return '⚠️ 올바른 수량을 입력해주세요.';
    // 최대 소수점 검사 — 가격과 수량 모두
    const decimals = selectedToken.decimals || 9;
    const checkDecimals = (val: string, label: string) => {
      const dotIdx = val.indexOf('.');
      if (dotIdx !== -1 && val.length - dotIdx - 1 > decimals) {
        return `⚠️ ${label}은 소수점 ${decimals}자리까지 가능합니다.`;
      }
      return null;
    };
    const priceErr = checkDecimals(String(price), '가격');
    if (priceErr) return priceErr;
    const qtyErr = checkDecimals(String(quantity), selectedToken.symbol);
    if (qtyErr) return qtyErr;
    // 최대값 검사 (오버플로우 방지)
    if (priceNum > 1e12) return '⚠️ 가격이 너무 큽니다.';
    if (qtyNum > 1e12) return '⚠️ 수량이 너무 큽니다.';
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
          {side === 'buy' ? '매수 주문' : '매도 주문'}
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
          매수 (BUY)
        </button>
        <button
          onClick={() => { setSide('sell'); setQuantity(''); }}
          className={`flex-1 py-2 rounded-lg text-center text-sm font-medium transition ${
            side === 'sell' ? 'bg-red-600 text-white' : 'text-gray-400'
          }`}
        >
          매도 (SELL)
        </button>
      </div>

      {/* Order Type Tab — 지정가 / 시장가 */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {(['limit', 'market'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
              orderType === t
                ? 'border-primary-500 text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t === 'limit' ? '지정가' : '시장가'}
          </button>
        ))}
      </div>

      {/* Token Selection */}
      <section className="mb-4 relative">
        <label className="text-sm text-gray-400 mb-1 block">토큰 선택</label>
        <button
          onClick={() => setShowTokenDropdown(!showTokenDropdown)}
          className="w-full bg-gray-800/50 rounded-xl p-4 flex items-center justify-between"
        >
          <div>
            <p className="font-medium">{selectedToken ? selectedToken.symbol : '토큰을 선택하세요'}</p>
            <p className="text-sm text-gray-400">
              {selectedToken ? `${selectedToken.symbol}/USDT` : '기축통화: USDT'}
            </p>
          </div>
          <span className="text-gray-400">▼</span>
        </button>

        {showTokenDropdown && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl z-10 max-h-48 overflow-y-auto">
            {tokens
              .filter((t) => t.symbol !== 'USDT')
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
          <label className="text-sm text-gray-400 mb-1 block">지정가 (USDT)</label>
          <div className="bg-gray-800/50 rounded-xl p-4 flex items-center gap-2">
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="가격을 입력하세요"
              min="0"
              step="any"
              className="bg-transparent flex-1 outline-none text-white placeholder-gray-500"
            />
            <button
              onClick={applyCurrentPrice}
              disabled={currentPrice === 0}
              className="bg-gray-700 text-xs px-2 py-1 rounded disabled:opacity-50 hover:bg-gray-600 transition"
            >
              최근가
            </button>
          </div>
          {currentPrice > 0 && (
            <p className="text-xs text-gray-500 mt-1">현재가: {currentPrice.toFixed(4)} USDT</p>
          )}
        </section>
      ) : (
        <section className="mb-4">
          <label className="text-sm text-gray-400 mb-1 block">체결가 (Market)</label>
          <div className="bg-gray-800/30 rounded-xl p-4 flex items-center justify-between border border-dashed border-gray-700">
            <span className="text-sm text-gray-400">
              {currentPrice > 0
                ? '현재가로 즉시 체결'
                : '현재가를 불러오는 중...'}
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
          수량
          {maxBalance > 0 && (
            <span className="text-primary-400 ml-2">
              (보유: {maxBalance.toFixed(4)})
            </span>
          )}
        </label>
        <div className="bg-gray-800/50 rounded-xl p-4">
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="수량을 입력하세요"
            min="0"
            step="any"
            className="bg-transparent w-full outline-none text-white placeholder-gray-500 mb-3"
          />
          <div className="flex gap-2">
            {QUICK_AMOUNT_RATIOS.map((ratio) => (
              <button
                key={ratio}
                onClick={() => applyQuickRatio(ratio, maxBalance)}
                disabled={maxBalance <= 0}
                className="flex-1 bg-gray-700 text-xs py-1.5 rounded-lg text-gray-300 hover:bg-gray-600 transition disabled:opacity-30"
              >
                {Math.round(ratio * 100)}%
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Order Summary */}
      {priceNum > 0 && qtyNum > 0 && (
        <section className="bg-gray-800/50 rounded-xl p-4 mb-6 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">주문 금액</span>
            <span>${totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">수수료 ({FEE_RATE * 100}%)</span>
            <span>${feeAmount.toFixed(2)}</span>
          </div>
          <hr className="border-gray-700" />
          <div className="flex justify-between font-medium">
            <span>총 {side === 'buy' ? '지불' : '수령'} 금액</span>
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
          ? '처리중...'
          : side === 'buy'
            ? `매수 주문하기 (${orderType === 'limit' ? 'Limit' : 'Market'})`
            : `매도 주문하기 (${orderType === 'limit' ? 'Limit' : 'Market'})`}
      </button>

      {/* Active Orders */}
      <section className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">미체결 주문</h2>
          <button
            onClick={() => fetchActiveOrders()}
            className="text-xs text-gray-400 hover:text-white transition"
          >
            새로고침
          </button>
        </div>
        {activeOrders.length === 0 ? (
          <p className="text-sm text-gray-400">미체결 주문이 없습니다</p>
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
                    cancelOrder(order.id)
                      .then(() => showToast('🗑️ 주문이 취소되었습니다.'))
                      .catch((err) => showToast(err instanceof Error ? err.message : '취소 실패'));
                  }}
                  className="text-xs px-3 py-1 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition"
                >
                  취소
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Orderbook Display */}
      {orderbook && (orderbook.bids.length > 0 || orderbook.asks.length > 0) && (
        <section className="mt-6">
          <h2 className="text-lg font-bold mb-3">📊 오더북</h2>
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Bids */}
              <div>
                <p className="text-xs text-green-400 mb-2 font-medium">매수 (Bids)</p>
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
                <p className="text-xs text-red-400 mb-2 font-medium">매도 (Asks)</p>
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
        title="🔒 지갑 서명"
        subtitle="주문 트랜잭션에 서명합니다"
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

import { Suspense } from 'react';

export default function TradePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">로딩...</div>}>
      <TradeContent />
    </Suspense>
  );
}
