'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useToast } from './Toast';

interface DepositModalProps {
  isOpen: boolean;
  walletAddress: string;
  onClose: () => void;
}

export default function DepositModal({ isOpen, walletAddress, onClose }: DepositModalProps) {
  const { showToast } = useToast();

  if (!isOpen) return null;

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress).then(
      () => showToast('📋 주소가 복사되었습니다.'),
      () => showToast('❌ 복사에 실패했습니다. 직접 선택해서 복사하세요.'),
    );
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 border border-gray-800">
        <h3 className="text-lg font-bold text-center mb-1">💰 입금</h3>
        <p className="text-sm text-gray-400 text-center mb-4">
          아래 주소로 솔라나(SOL)를 입금하세요
        </p>

        {/* QR Code */}
        <div className="flex justify-center mb-4">
          <div className="bg-white p-4 rounded-xl">
            <QRCodeSVG
              value={walletAddress}
              size={180}
              level="M"
              includeMargin={false}
            />
          </div>
        </div>

        {/* Wallet Address */}
        <div className="bg-gray-800 rounded-xl p-3 mb-4">
          <p className="text-xs text-gray-400 mb-1">내 지갑 주소</p>
          <p className="text-xs font-mono break-all text-gray-300">
            {walletAddress}
          </p>
        </div>

        <button
          onClick={copyAddress}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-xl font-medium transition mb-2"
        >
          📋 주소 복사
        </button>
        <button
          onClick={onClose}
          className="w-full bg-gray-800 text-gray-300 py-3 rounded-xl font-medium transition"
        >
          닫기
        </button>

        <p className="text-xs text-gray-500 text-center mt-3">
          ⚠️ Solana 네트워크(SPL) 주소만 입금 가능합니다.
          <br />
          다른 체인에서 입금 시 복구할 수 없습니다.
        </p>
      </div>
    </div>
  );
}
