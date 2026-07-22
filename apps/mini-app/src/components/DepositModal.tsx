'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n';

interface DepositModalProps {
  isOpen: boolean;
  walletAddress: string;
  onClose: () => void;
}

export default function DepositModal({ isOpen, walletAddress, onClose }: DepositModalProps) {
  const { showToast } = useToast();
  const { t } = useT();

  if (!isOpen) return null;

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress).then(
      () => showToast(t('deposit.copied')),
      () => showToast(t('deposit.copyFailed')),
    );
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 border border-gray-800">
        <h3 className="text-lg font-bold text-center mb-1">{t('deposit.title')}</h3>
        <p className="text-sm text-gray-400 text-center mb-4">
          {t('deposit.desc')}
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
          <p className="text-xs text-gray-400 mb-1">{t('deposit.myAddress')}</p>
          <p className="text-xs font-mono break-all text-gray-300">
            {walletAddress}
          </p>
        </div>

        <button
          onClick={copyAddress}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-xl font-medium transition mb-2"
        >
          {t('deposit.copyAddress')}
        </button>
        <button
          onClick={onClose}
          className="w-full bg-gray-800 text-gray-300 py-3 rounded-xl font-medium transition"
        >
          {t('common.close')}
        </button>

        <p className="text-xs text-gray-500 text-center mt-3">
          {t('deposit.warning')}
          <br />
          {t('deposit.warningLine2')}
        </p>
      </div>
    </div>
  );
}