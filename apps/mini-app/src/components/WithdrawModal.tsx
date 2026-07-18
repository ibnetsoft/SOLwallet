'use client';

import { useState } from 'react';
import { useWalletStore } from '@/stores/useWalletStore';
import { useToast } from './Toast';
import PinModal from './PinModal';
import { submitWithdraw } from '@/lib/api/withdraw';
import { buildSolTransferTx, signTransaction } from '@/lib/wallet';

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

  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const amountNum = Number(amount) || 0;
  const isValid = toAddress && amountNum > 0 && amountNum <= solBalance;

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
        throw new Error('지갑 잠금 해제에 실패했습니다.');
      }

      // 2. SOL 전송 트랜잭션 빌드
      const unsignedTx = buildSolTransferTx(walletAddress, toAddress.trim(), amountNum);

      // 3. 온디바이스 서명
      const signedTx = signTransaction(unsignedTx, secretKey);

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
      onClose();

      showToast(`✅ 출금 완료! Tx: ${result.txSignature.slice(0, 8)}...`);
    } catch (err) {
      lockWallets();
      setPinError(err instanceof Error ? err.message : '출금 실패');
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
      onClose();
    }
  };

  return (
    <>
      {/* 출금 폼 모달 */}
      {!showPin && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 border border-gray-800">
            <h3 className="text-lg font-bold text-center mb-1">💸 출금</h3>
            <p className="text-sm text-gray-400 text-center mb-4">
              보유: {solBalance.toFixed(6)} SOL
            </p>

            {/* 수신 주소 */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">받는 주소</label>
              <input
                type="text"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                placeholder="Solana 지갑 주소"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500 transition font-mono"
              />
            </div>

            {/* 수량 */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">수량 (SOL)</label>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  step="0.000001"
                  min="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500 transition"
                />
                <button
                  onClick={() => setAmount(String(solBalance))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-gray-700 px-2 py-1 rounded text-gray-300 hover:bg-gray-600"
                >
                  최대
                </button>
              </div>
              {amountNum > solBalance && (
                <p className="text-xs text-red-400 mt-1">잔액이 부족합니다</p>
              )}
            </div>

            {/* 경고 */}
            <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-2 mb-4">
              <p className="text-xs text-yellow-400 text-center">
                ⚠️ 주소를 다시 확인하세요. 잘못된 주소로 출금 시 복구 불가.
              </p>
            </div>

            {/* 버튼 */}
            <div className="flex gap-2">
              <button
                onClick={handleClose}
                disabled={isProcessing}
                className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-300 font-medium transition disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (!isValid) {
                    showToast('⚠️ 주소와 수량을 확인해주세요.');
                    return;
                  }
                  setShowPin(true);
                }}
                disabled={!isValid || isProcessing}
                className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-medium transition disabled:opacity-50"
              >
                출금하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIN 입력 모달 */}
      <PinModal
        isOpen={showPin}
        title="🔒 출금 서명"
        subtitle="출금 트랜잭션에 서명합니다"
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
