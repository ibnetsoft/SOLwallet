'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n';

interface MnemonicDisplayProps {
  isOpen: boolean;
  mnemonic: string;
  onClose: () => void;
}

export default function MnemonicDisplay({
  isOpen,
  mnemonic,
  onClose,
}: MnemonicDisplayProps) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [hidden, setHidden] = useState(true);
  const words = mnemonic.split(' ');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      // 30초 후 클립보드에서 시드 구문 제거 (보안)
      setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => {});
      }, 30_000);
    } catch {
      // fallback
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 border border-gray-800">
        <h3 className="text-lg font-bold text-center mb-1">
          {t('mnemonic.title')}
        </h3>
        <p className="text-sm text-gray-400 text-center mb-4">
          {t('mnemonic.desc')}<br />
          {t('mnemonic.descLine2')}
        </p>

        {/* 보안 경고 */}
        <div className="bg-red-900/30 border border-red-800/50 rounded-lg p-3 mb-4">
          <p className="text-xs text-red-400">
            <span dangerouslySetInnerHTML={{ __html: t('mnemonic.danger') }} />
            <br />
            {t('mnemonic.dangerLine2')}
          </p>
        </div>

        {/* 단어 그리드 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {words.map((word, i) => (
            <div
              key={i}
              className="bg-gray-800 rounded-lg p-2 text-center"
            >
              <span className="text-xs text-gray-500">{i + 1}.</span>{' '}
              <span className="text-sm font-mono">
                {hidden ? '•'.repeat(word.length) : word}
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setHidden(!hidden)}
            className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm"
          >
            {hidden ? t('mnemonic.show') : t('mnemonic.hide')}
          </button>
          <button
            onClick={handleCopy}
            className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm"
          >
            {copied ? t('mnemonic.copied') : t('mnemonic.copy')}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-primary-600 text-white font-medium"
        >
          {t('mnemonic.acknowledged')}
        </button>
      </div>
    </div>
  );
}