'use client';

import { useState } from 'react';

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
  const [copied, setCopied] = useState(false);
  const [hidden, setHidden] = useState(true);
  const words = mnemonic.split(' ');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 border border-gray-800">
        <h3 className="text-lg font-bold text-center mb-1">
          🔐 시드 구문 (안전하게 보관하세요!)
        </h3>
        <p className="text-sm text-gray-400 text-center mb-4">
          이 단어들은 지갑을 복구하는 유일한 수단입니다.<br />
          종이에 적어 안전한 곳에 보관하세요.
        </p>

        {/* 보안 경고 */}
        <div className="bg-red-900/30 border border-red-800/50 rounded-lg p-3 mb-4">
          <p className="text-xs text-red-400">
            🚨 <strong>절대</strong> 스크린샷을 찍거나 타인과 공유하지 마세요.<br />
            이 시드 구문은 다시 보여지지 않습니다.
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
            {hidden ? '👁️ 보기' : '🙈 숨기기'}
          </button>
          <button
            onClick={handleCopy}
            className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm"
          >
            {copied ? '✅ 복사됨!' : '📋 복사'}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-primary-600 text-white font-medium"
        >
          확인했습니다
        </button>
      </div>
    </div>
  );
}
