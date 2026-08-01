'use client';

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

/** 토스트 표시 시간 — 너무 빨리 사라진다는 피드백으로 기존 3초에서 2배로 늘림 */
const TOAST_DURATION = 6000;

// ─── Context ───

interface ToastContextValue {
  toast: string | null;
  showToast: (msg: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: null,
  showToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

// ─── Provider ───

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  // 토스트가 연속으로 뜰 때, 먼저 예약된 타이머가 나중 토스트를 조기에 지우는 것을 방지
  const toastIdRef = useRef(0);

  const showToast = useCallback((msg: string) => {
    const id = ++toastIdRef.current;
    setToast(msg);
    setTimeout(() => {
      if (toastIdRef.current === id) setToast(null);
    }, TOAST_DURATION);
  }, []);

  return (
    <ToastContext.Provider value={{ toast, showToast }}>
      {children}
      {toast && (
        <div className="fixed top-4 left-4 right-4 z-50 flex justify-center pointer-events-none">
          <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-sm shadow-lg animate-[fadeIn_0.2s_ease-out]">
            {toast}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
