'use client';

import { useState, useRef, useCallback } from 'react';

interface PinModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  onConfirm: (pin: string) => Promise<void>;
  onCancel: () => void;
  error?: string;
}

export default function PinModal({
  isOpen,
  title,
  subtitle,
  onConfirm,
  onCancel,
  error,
}: PinModalProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePinChange = useCallback((value: string) => {
    // 숫자만, 최대 6자리
    const filtered = value.replace(/\D/g, '').slice(0, 6);
    if (step === 'input') setPin(filtered);
    else setConfirmPin(filtered);
    setLocalError('');
  }, [step]);

  const handleNext = async () => {
    if (pin.length < 4) {
      setLocalError('PIN은 최소 4자리입니다.');
      return;
    }

    if (step === 'input') {
      setStep('confirm');
      setConfirmPin('');
      inputRef.current?.focus();
      return;
    }

    // confirm 단계
    if (confirmPin !== pin) {
      setLocalError('PIN이 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      await onConfirm(pin);
      // 성공하면 모달 닫기
      setPin('');
      setConfirmPin('');
      setStep('input');
      setLocalError('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setPin('');
    setConfirmPin('');
    setStep('input');
    setLocalError('');
    onCancel();
  };

  // PIN 도트 표시
  const renderDots = (length: number) => (
    <div className="flex gap-3 justify-center my-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className={`w-4 h-4 rounded-full border-2 transition-all ${
            i < length
              ? 'bg-primary-500 border-primary-500'
              : 'bg-transparent border-gray-600'
          }`}
        />
      ))}
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 border border-gray-800">
        <h3 className="text-lg font-bold text-center mb-1">{title}</h3>
        {subtitle && (
          <p className="text-sm text-gray-400 text-center mb-2">{subtitle}</p>
        )}

        <p className="text-sm text-gray-400 text-center mb-2">
          {step === 'input' ? 'PIN을 설정하세요 (4~6자리)' : 'PIN을 다시 입력하세요'}
        </p>

        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          value={step === 'input' ? pin : confirmPin}
          onChange={(e) => handlePinChange(e.target.value)}
          className="opacity-0 absolute w-0 h-0"
          autoFocus
        />

        {renderDots((step === 'input' ? pin : confirmPin).length)}

        {/* 숫자 키패드 */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, '⌫'].map((key) => (
            <button
              key={key === null ? 'empty' : key}
              className={`h-12 rounded-xl text-lg font-medium flex items-center justify-center
                ${key === null ? 'invisible' : 'bg-gray-800 active:bg-gray-700'}
                ${key === '⌫' ? 'text-red-400' : 'text-white'}`}
              onClick={() => {
                if (key === null) return;
                if (key === '⌫') {
                  if (step === 'input') {
                    setPin((p) => p.slice(0, -1));
                  } else {
                    setConfirmPin((p) => p.slice(0, -1));
                  }
                  setLocalError('');
                } else {
                  handlePinChange(
                    (step === 'input' ? pin : confirmPin) + String(key),
                  );
                }
              }}
            >
              {key}
            </button>
          ))}
        </div>

        {(localError || error) && (
          <p className="text-red-400 text-sm text-center mt-3">{localError || error}</p>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleCancel}
            className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-300 font-medium"
          >
            취소
          </button>
          <button
            onClick={handleNext}
            disabled={loading || (step === 'input' ? pin.length < 4 : confirmPin.length < 4)}
            className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-medium disabled:opacity-50"
          >
            {loading ? '처리중...' : step === 'input' ? '다음' : '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}
