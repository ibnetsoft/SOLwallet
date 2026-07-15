'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

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

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
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
