'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWalletStore } from '@/stores/useWalletStore';
import { useToast } from './Toast';
import PinModal from './PinModal';
import { submitWithdraw, checkWithdrawAddress } from '@/lib/api/withdraw';
import { buildSolTransferTx, buildSplTokenTransferTx, signTransaction } from '@/lib/wallet';
import { useT } from '@/lib/i18n';

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const NEW_ACCOUNT_MIN_WITHDRAW = 0.001;
const DEBOUNCE_MS = 500;

type AddressCheck = 'idle' | 'checking' | 'new' | 'existing' | 'invalid';

interface WithdrawToken {
  mint: string;
  symbol: string;
  decimals: number;
  balance: number;
  isNative?: boolean;
  logoUrl?: string;
}

interface WithdrawModalProps {
  isOpen: boolean;
  walletId: string;
  walletAddress: string;
  tokens: WithdrawToken[];
  solBalance: number;
  onClose: () => void;
}

export default function WithdrawModal({
  isOpen,
  walletId,
  walletAddress,
  tokens,
  solBalance,
  onClose,
}: WithdrawModalProps) {
  const { showToast } = useToast();
  const { unlockWallet, lockWallets } = useWalletStore();
  const { t } = useT();

  // 단계: 'select' (토큰 선택) | 'form' (출금 입력)
  const [step, setStep] = useState<'select' | 'form'>('select');
  const [selectedToken, setSelectedToken] = useState<WithdrawToken | null>(null);

  // 출금 폼 상태
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [addressCheck, setAddressCheck] = useState<AddressCheck>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 모달 닫을 때 초기화
  useEffect(() => {
    if (!isOpen) {
      setStep('select');
      setSelectedToken(null);
      setToAddress('');
      setAmount('');
      setPinError('');
      setShowPin(false);
      setAddressCheck('idle');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isSol = selectedToken?.mint === SOL_MINT;
  const amountNum = Number(amount) || 0;

  // SOL: 0.001 SOL 남겨야 함 (수수료/rent), SPL: 전액 출금 가능
  const maxWithdrawable = isSol
    ? Math.max(0, selectedToken!.balance - 0.001)
    : selectedToken?.balance ?? 0;

  // 새 SOL 주소 최소 출금액
  const effectiveMinWithdraw = isSol && addressCheck === 'new' ? NEW_ACCOUNT_MIN_WITHDRAW : 0;

  // SPL 토큰 출금 시 SOL 잔액 부족 체크 (네트워크 수수료 필요: ~0.000005 SOL)
  const solFeeOk = isSol || solBalance > 0.00001;

  const isValid = toAddress &&
    addressCheck !== 'invalid' &&
    addressCheck !== 'checking' &&
    amountNum > 0 &&
    amountNum <= maxWithdrawable &&
    amountNum >= effectiveMinWithdraw &&
    solFeeOk;

  // ─── 수신 주소 실시간 체크 (SOL 전용 — SPL에는 불필요) ───
  const doCheckAddress = useCallback(async (addr: string) => {
    if (!addr) {
      setAddressCheck('idle');
      return;
    }
    if (!SOLANA_ADDRESS_RE.test(addr)) {
      setAddressCheck('invalid');
      return;
    }
    setAddressCheck('checking');
    try {
      const result = await checkWithdrawAddress(addr);
      setAddressCheck(result.isNewAccount ? 'new' : 'existing');
    } catch {
      setAddressCheck('existing');
    }
  }, []);

  useEffect(() => {
    // SPL 토큰 출금 시에는 주소 체크 불필요
    if (!isSol) {
      setAddressCheck('idle');
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }

    const trimmed = toAddress.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!trimmed) {
      setAddressCheck('idle');
      return;
    }
    if (!SOLANA_ADDRESS_RE.test(trimmed)) {
      if (trimmed.length < 32) {
        setAddressCheck('idle');
      } else {
        setAddressCheck('invalid');
      }
      return;
    }
    debounceRef.current = setTimeout(() => doCheckAddress(trimmed), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [toAddress, isSol, doCheckAddress]);

  // ─── 출금 실행 ───
  const handleWithdraw = async (pin: string) => {
    setPinError('');
    setIsProcessing(true);

    try {
      await unlockWallet(walletId, pin);

      const wallets = useWalletStore.getState().wallets;
      const secretKey = wallets.find((w) => w.id === walletId)?.secretKey;

      if (!secretKey) {
        lockWallets();
        throw new Error(t('error.walletUnlockFailed'));
      }

      // tx 빌드 (SOL vs SPL)
      const mint = selectedToken!.mint;
      let unsignedTx: string;
      if (isSol) {
        unsignedTx = await buildSolTransferTx(walletAddress, toAddress.trim(), amountNum);
      } else {
        unsignedTx = await buildSplTokenTransferTx(
          walletAddress,
          toAddress.trim(),
          mint,
          amountNum,
          selectedToken!.decimals,
        );
      }

      // 서명 (legacy — 모든 일반 전송은 legacy)
      const signedTx = signTransaction(unsignedTx, secretKey, 'legacy');

      // 서버에 제출
      const result = await submitWithdraw({
        walletId,
        toAddress: toAddress.trim(),
        mint,
        amount: amountNum,
        signedTx,
      });

      lockWallets();
      setShowPin(false);
      setToAddress('');
      setAmount('');
      setSelectedToken(null);
      setStep('select');
      onClose();

      showToast(t('withdraw.complete', { tx: result.txSignature.slice(0, 8) }));
    } catch (err) {
      lockWallets();
      setPinError(err instanceof Error ? err.message : t('withdraw.failed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (!isProcessing) {
      setStep('select');
      setSelectedToken(null);
      setToAddress('');
      setAmount('');
      setPinError('');
      setShowPin(false);
      setAddressCheck('idle');
      onClose();
    }
  };

  // 토큰 잔액 소수점 자릿수
  const balanceDecimals = selectedToken?.isNative ? 6 : (selectedToken?.decimals ?? 6);
  const stepDecimals = selectedToken?.decimals ?? 6;

  // ═══════════════════════════════════════════════════
  // STEP 1: 토큰 선택
  // ═══════════════════════════════════════════════════
  if (step === 'select') {
    const hasAnyBalance = tokens.some((tk) => tk.balance > 0);

    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 border border-gray-800">
          <h3 className="text-lg font-bold text-center mb-1">{t('withdraw.title')}</h3>
          <p className="text-sm text-gray-400 text-center mb-4">
            {t('withdraw.selectToken')}
          </p>

          {!hasAnyBalance ? (
            <p className="text-sm text-gray-500 text-center py-8">
              {t('withdraw.noBalance')}
            </p>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {tokens.map((tk) => {
                const canWithdraw = tk.balance > 0 && (tk.isNative || solBalance > 0.00001);
                return (
                  <button
                    key={tk.mint}
                    onClick={() => {
                      if (!canWithdraw) return;
                      setSelectedToken(tk);
                      setStep('form');
                    }}
                    disabled={!canWithdraw}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl transition ${
                      canWithdraw
                        ? 'bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50 active:bg-gray-700/70'
                        : 'bg-gray-800/20 border border-gray-800/30 opacity-40 cursor-not-allowed'
                    }`}
                  >
                    {/* 토큰 로고 */}
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-gray-700 flex items-center justify-center shrink-0">
                      {tk.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={tk.logoUrl}
                          alt={tk.symbol}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <span className="text-xs font-bold text-gray-300">
                          {tk.symbol.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* 심볼 + 잔액 */}
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium">{tk.symbol}</p>
                      <p className="text-[10px] text-gray-500">
                        {t('withdraw.splBalance', {
                          balance: tk.balance.toFixed(balanceDecimals),
                          symbol: tk.symbol,
                        })}
                      </p>
                    </div>

                    {/* USD value */}
                    <div className="text-right">
                      <p className="text-sm tabular-nums text-gray-300">
                        {tk.balance.toFixed(balanceDecimals)}
                      </p>
                      <p className="text-[10px] text-gray-500">{tk.symbol}</p>
                    </div>

                    {!canWithdraw && !tk.isNative && solBalance <= 0.00001 && tk.balance > 0 && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <span className="text-[9px] text-red-400" title={t('withdraw.noSolForFee')}>
                          ⚠️
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <button
            onClick={handleClose}
            className="w-full mt-4 py-3 rounded-xl bg-gray-800 text-gray-300 font-medium transition hover:bg-gray-700"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════
  // STEP 2: 출금 입력 폼
  // ═══════════════════════════════════════════════════
  const AddressStatusIcon = () => {
    if (addressCheck === 'checking') {
      return (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="w-4 h-4 border-2 border-gray-400 border-t-gray-200 rounded-full animate-spin" />
        </div>
      );
    }
    return null;
  };

  const AddressCheckMessage = () => {
    if (addressCheck === 'invalid') {
      return (
        <div className="bg-red-900/20 border border-red-800/40 rounded-lg p-2">
          <p className="text-xs text-red-400 text-center">
            {t('withdraw.invalidAddress')}
          </p>
        </div>
      );
    }
    if (addressCheck === 'new') {
      return (
        <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-2">
          <p className="text-xs text-yellow-400 text-center">
            {t('withdraw.newAddressWarning')}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <>
      {/* 출금 폼 모달 */}
      {!showPin && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 border border-gray-800">
            {/* 헤더: 뒤로가기 + 선택 토큰 */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => {
                  setStep('select');
                  setToAddress('');
                  setAmount('');
                  setAddressCheck('idle');
                }}
                className="p-1.5 rounded-lg hover:bg-gray-700/70 transition text-gray-400 shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-7 h-7 rounded-full overflow-hidden bg-gray-700 flex items-center justify-center shrink-0">
                  {selectedToken?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedToken.logoUrl}
                      alt={selectedToken.symbol}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <span className="text-[10px] font-bold text-gray-300">
                      {selectedToken?.symbol.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold truncate">{selectedToken?.symbol} {t('withdraw.title')}</h3>
                  <p className="text-[10px] text-gray-500 truncate">
                    {t('withdraw.splBalance', {
                      balance: selectedToken!.balance.toFixed(balanceDecimals),
                      symbol: selectedToken!.symbol,
                    })}
                  </p>
                </div>
              </div>
            </div>

            {/* 수신 주소 */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">{t('withdraw.toAddress')}</label>
              <div className="relative">
                <input
                  type="text"
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                  placeholder={t('withdraw.addressPlaceholder')}
                  className={`w-full bg-gray-800 border rounded-lg px-3 py-3 pr-10 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500 transition font-mono ${
                    addressCheck === 'invalid' ? 'border-red-500' :
                    addressCheck === 'new' ? 'border-yellow-500' :
                    addressCheck === 'existing' ? 'border-green-500/40' :
                    'border-gray-700'
                  }`}
                />
                <AddressStatusIcon />
              </div>
              <div className="mt-1.5">
                <AddressCheckMessage />
              </div>
            </div>

            {/* 수량 */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">{t('withdraw.amount')}</label>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  step={`0.${'0'.repeat(Math.max(0, stepDecimals - 1))}1`}
                  min="0"
                  className={`w-full bg-gray-800 border rounded-lg px-3 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500 transition ${
                    amountNum > 0 && amountNum < effectiveMinWithdraw ? 'border-red-500' : 'border-gray-700'
                  }`}
                />
                <button
                  onClick={() => setAmount(String(maxWithdrawable))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-gray-700 px-2 py-1 rounded text-gray-300 hover:bg-gray-600"
                >
                  {t('common.max')}
                </button>
              </div>
              {amountNum > 0 && amountNum < effectiveMinWithdraw && (
                <p className="text-xs text-red-400 mt-1">
                  {t('withdraw.minWithdraw')}
                </p>
              )}
              {amountNum > maxWithdrawable && amountNum > 0 && (
                <p className="text-xs text-red-400 mt-1">{t('withdraw.insufficient')}</p>
              )}
              {isSol && effectiveMinWithdraw > 0 && amountNum === 0 && (
                <p className="text-[10px] text-gray-500 mt-1">
                  * {t('withdraw.minWithdraw')}
                </p>
              )}
            </div>

            {/* SPL 토큰: SOL 잔액 부족 경고 */}
            {!isSol && !solFeeOk && (
              <div className="bg-red-900/20 border border-red-800/40 rounded-lg p-2 mb-4">
                <p className="text-xs text-red-400 text-center">
                  {t('withdraw.noSolForFee')}
                </p>
              </div>
            )}

            {/* 경고 */}
            <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-2 mb-4">
              <p className="text-xs text-yellow-400 text-center">
                {t('withdraw.warning')}
              </p>
            </div>

            {/* 버튼 */}
            <div className="flex gap-2">
              <button
                onClick={handleClose}
                disabled={isProcessing}
                className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-300 font-medium transition disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  if (!isValid) {
                    showToast(t('withdraw.checkFields'));
                    return;
                  }
                  setShowPin(true);
                }}
                disabled={!isValid || isProcessing}
                className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-medium transition disabled:opacity-50"
              >
                {t('withdraw.submit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIN 입력 모달 */}
      <PinModal
        isOpen={showPin}
        title={t('withdraw.pinTitle')}
        subtitle={t('withdraw.pinSubtitle')}
        onConfirm={handleWithdraw}
        onCancel={() => {
          setShowPin(false);
          setPinError('');
          lockWallets();
        }}
        error={pinError}
      />
    </>
  );
}
