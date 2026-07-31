'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWalletStore } from '@/stores/useWalletStore';
import { useToast } from './Toast';
import PinModal from './PinModal';
import { submitWithdraw, checkWithdrawAddress } from '@/lib/api/withdraw';
import { buildSolTransferTx, signTransaction } from '@/lib/wallet';
import { useT } from '@/lib/i18n';

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEW_ACCOUNT_MIN_WITHDRAW = 0.001;
const DEBOUNCE_MS = 500;

type AddressCheck = 'idle' | 'checking' | 'new' | 'existing' | 'invalid';

interface WithdrawModalProps {
  isOpen: boolean;
  walletId: string;
  walletAddress: string;
  solBalance: number;
  onClose: () => void;
}

export default function WithdrawModal({
  isOpen,
  walletId,
  walletAddress,
  solBalance,
  onClose,
}: WithdrawModalProps) {
  const { showToast } = useToast();
  const { unlockWallet, lockWallets } = useWalletStore();
  const { t } = useT();

  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [addressCheck, setAddressCheck] = useState<AddressCheck>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!isOpen) return null;

  const amountNum = Number(amount) || 0;
  // 출금 후 tx 수수료 + rent 예치금(0.001 SOL)이 남아야 함
  const maxWithdrawable = Math.max(0, solBalance - 0.001);

  // 새 주소일 때 최소 출금액 제한
  const effectiveMinWithdraw = addressCheck === 'new' ? NEW_ACCOUNT_MIN_WITHDRAW : 0;
  const isValid = toAddress &&
    addressCheck !== 'invalid' &&
    addressCheck !== 'checking' &&
    amountNum > 0 &&
    amountNum <= maxWithdrawable &&
    amountNum >= effectiveMinWithdraw;

  // ─── 수신 주소 실시간 체크 (디바운스) ───
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
      // API 실패 시 안전하게 기존 계정으로 간주
      setAddressCheck('existing');
    }
  }, []);

  useEffect(() => {
    const trimmed = toAddress.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!trimmed) {
      setAddressCheck('idle');
      return;
    }
    // 유효하지 않은 길이면 즉시 invalid (디바운스 불필요)
    if (!SOLANA_ADDRESS_RE.test(trimmed)) {
      // 아직 입력 중일 수 있으므로 idle 유지 (짧은 주소)
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
  }, [toAddress, doCheckAddress]);

  const handleWithdraw = async (pin: string) => {
    setPinError('');
    setIsProcessing(true);

    try {
      // 1. 지갑 잠금 해제
      await unlockWallet(walletId, pin);

      const wallets = useWalletStore.getState().wallets;
      const secretKey = wallets.find((w) => w.id === walletId)?.secretKey;

      if (!secretKey) {
        lockWallets();
        throw new Error(t('error.walletUnlockFailed'));
      }

      // 2. SOL 전송 트랜잭션 빌드 (blockhash 포함)
      const unsignedTx = await buildSolTransferTx(walletAddress, toAddress.trim(), amountNum);

      // 3. 온디바이스 서명 (SOL 전송 = legacy)
      const signedTx = signTransaction(unsignedTx, secretKey, 'legacy');

      // 4. 서버에 제출
      const result = await submitWithdraw({
        walletId,
        toAddress: toAddress.trim(),
        mint: 'So11111111111111111111111111111111111111112',
        amount: amountNum,
        signedTx,
      });

      // 5. 메모리에서 키 해제
      lockWallets();

      // 6. 성공 처리
      setShowPin(false);
      setToAddress('');
      setAmount('');
      setAddressCheck('idle');
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
      setToAddress('');
      setAmount('');
      setPinError('');
      setShowPin(false);
      setAddressCheck('idle');
      onClose();
    }
  };

  // 주소 입력창 우측 아이콘
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

  // 주소 검증 메시지
  const AddressCheckMessage = () => {
    if (addressCheck === 'invalid') {
      return (
        <div className="bg-red-900/20 border border-red-800/40 rounded-lg p-2">
          <p className="text-xs text-red-400 text-center">
            {t('withdraw.invalidAddress') || '올바른 Solana 주소 형식이 아닙니다.'}
          </p>
        </div>
      );
    }
    if (addressCheck === 'new') {
      return (
        <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-2">
          <p className="text-xs text-yellow-400 text-center">
            {t('withdraw.newAddressWarning') || '새 주소입니다. 최소 0.001 SOL 이상 출금해야 합니다.'}
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
            <h3 className="text-lg font-bold text-center mb-1">{t('withdraw.title')}</h3>
            <p className="text-sm text-gray-400 text-center mb-4">
              {t('withdraw.balance')} {solBalance.toFixed(6)} SOL
            </p>

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
                  step="0.000001"
                  min="0"
                  className={`w-full bg-gray-800 border rounded-lg px-3 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500 transition ${
                    amountNum > 0 && amountNum < effectiveMinWithdraw ? 'border-red-500' : 'border-gray-700'
                  }`}
                />
                <button
                  onClick={() => setAmount(String(Math.max(0, solBalance - 0.001)))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-gray-700 px-2 py-1 rounded text-gray-300 hover:bg-gray-600"
                >
                  {t('common.max')}
                </button>
              </div>
              {amountNum > 0 && amountNum < effectiveMinWithdraw && (
                <p className="text-xs text-red-400 mt-1">
                  {t('withdraw.minWithdraw') || '최소 0.001 SOL 이상 입력해 주세요.'}
                </p>
              )}
              {amountNum > solBalance && (
                <p className="text-xs text-red-400 mt-1">{t('withdraw.insufficient')}</p>
              )}
              {addressCheck === 'new' && effectiveMinWithdraw > 0 && amountNum === 0 && (
                <p className="text-[10px] text-gray-500 mt-1">
                  * 최소 출금액: 0.001 SOL (새 주소)
                </p>
              )}
            </div>

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
