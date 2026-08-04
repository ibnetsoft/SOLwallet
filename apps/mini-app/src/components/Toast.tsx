'use client';

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';

/** 토스트 표시 시간 — 너무 빨리 사라진다는 피드백으로 기존 3초에서 2배로 늘림 */
const TOAST_DURATION = 6000;

export type ToastVariant = 'success' | 'warning' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

// ─── Context ───

interface ToastContextValue {
  toast: string | null;
  showToast: (msg: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: null,
  showToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

// ─── variant별 스타일 ───

const VARIANT_STYLES: Record<ToastVariant, { bg: string; border: string; icon: string; Icon: typeof CheckCircle }> = {
  success: {
    bg: 'bg-gray-800',
    border: 'border-gray-700',
    icon: 'text-gray-400',
    Icon: CheckCircle,
  },
  warning: {
    bg: 'bg-amber-950/90',
    border: 'border-amber-600/50',
    icon: 'text-amber-400',
    Icon: AlertTriangle,
  },
  error: {
    bg: 'bg-red-950/90',
    border: 'border-red-600/50',
    icon: 'text-red-400',
    Icon: XCircle,
  },
  info: {
    bg: 'bg-blue-950/90',
    border: 'border-blue-600/50',
    icon: 'text-blue-400',
    Icon: Info,
  },
};

// ─── Provider ───

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastItem | null>(null);
  // 토스트가 연속으로 뜰 때, 먼저 예약된 타이머가 나중 토스트를 조기에 지우는 것을 방지
  const toastIdRef = useRef(0);

  const showToast = useCallback((msg: string, variant: ToastVariant = 'success') => {
    const id = ++toastIdRef.current;
    setCurrent({ id, message: msg, variant });
    setTimeout(() => {
      if (toastIdRef.current === id) setCurrent(null);
    }, TOAST_DURATION);
  }, []);

  const style = current ? VARIANT_STYLES[current.variant] : VARIANT_STYLES.success;
  const VariantIcon = style.Icon;

  return (
    <ToastContext.Provider value={{ toast: current?.message ?? null, showToast }}>
      {children}
      {current && (
        <div className="fixed top-4 left-4 right-4 z-50 flex justify-center pointer-events-none">
          <div className={`${style.bg} ${style.border} border rounded-xl px-4 py-3 text-sm shadow-lg animate-[fadeIn_0.2s_ease-out] flex items-start gap-2.5 max-w-sm`}>
            <VariantIcon className={`w-4 h-4 mt-0.5 shrink-0 ${style.icon}`} strokeWidth={2} />
            <span className="flex-1 leading-relaxed">{current.message}</span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
