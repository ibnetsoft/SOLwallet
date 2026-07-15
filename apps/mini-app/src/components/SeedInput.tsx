'use client';

import { useState, useRef } from 'react';
import { validateMnemonic } from '@/lib/wallet/import';

interface SeedInputProps {
  isOpen: boolean;
  title?: string;
  onConfirm: (mnemonic: string) => void;
  onCancel: () => void;
}

export default function SeedInput({
  isOpen,
  title = '📥 시드구문 Import',
  onConfirm,
  onCancel,
}: SeedInputProps) {
  const [mnemonic, setMnemonic] = useState('');
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleConfirm = () => {
    const trimmed = mnemonic.trim();

    if (!trimmed) {
      setError('시드 구문을 입력해주세요.');
      return;
    }

    const words = trimmed.split(/\s+/);

    if (words.length !== 12 && words.length !== 24) {
      setError('시드 구문은 12단어 또는 24단어여야 합니다.');
      return;
    }

    if (!validateMnemonic(trimmed)) {
      setError('유효하지 않은 시드 구문입니다. 다시 확인해주세요.');
      return;
    }

    setError('');
    onConfirm(trimmed);
    setMnemonic('');
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setMnemonic(text.trim());
      setError('');
    } catch {
      setError('클립보드 접근 권한이 필요합니다.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 border border-gray-800">
        <h3 className="text-lg font-bold text-center mb-1">{title}</h3>
        <p className="text-sm text-gray-400 text-center mb-4">
          기존 지갑의 12단어 또는 24단어 시드 구문을 입력하세요
        </p>

        <textarea
          ref={textareaRef}
          value={mnemonic}
          onChange={(e) => {
            setMnemonic(e.target.value);
            setError('');
          }}
          placeholder="word1 word2 word3 ..."
          className="w-full h-28 bg-gray-800 rounded-xl p-3 text-sm font-mono text-white placeholder:text-gray-600 resize-none focus:outline-none focus:ring-1 focus:ring-primary-500"
          autoFocus
        />

        {error && (
          <p className="text-red-400 text-xs mt-2">{error}</p>
        )}

        {/* 힌트 */}
        <div className="flex items-center gap-2 mt-3 mb-4">
          <span className="text-xs text-gray-500">
            단어 수: {mnemonic.trim() ? mnemonic.trim().split(/\s+/).length : 0}
          </span>
          <button
            onClick={handlePaste}
            className="ml-auto text-xs text-primary-400 underline"
          >
            📋 붙여넣기
          </button>
        </div>

        {/* 보안 경고 */}
        <div className="bg-yellow-900/30 border border-yellow-800/50 rounded-lg p-3 mb-4">
          <p className="text-xs text-yellow-400">
            ⚠️ 시드 구문은 절대 타인과 공유하지 마세요.<br />
            이 앱은 시드 구문을 서버로 전송하지 않습니다.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              setMnemonic('');
              setError('');
              onCancel();
            }}
            className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-300 font-medium"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={!mnemonic.trim()}
            className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-medium disabled:opacity-50"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
