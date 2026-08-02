'use client';

import { useEffect } from 'react';

/**
 * 루트 레이아웃(layout.tsx) 자체가 죽었을 때만 발동하는 최후의 에러 바운더리.
 * app/error.tsx와 동일하게 서버로 스택을 보고한다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';
    fetch(`${API_BASE}/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `[global] ${error.message}`,
        stack: error.stack,
        digest: error.digest,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html>
      <body>
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
          textAlign: 'center', background: '#030712', color: '#fff',
        }}>
          <p style={{ fontSize: 18, fontWeight: 700 }}>일시적인 오류가 발생했습니다</p>
          <button
            onClick={reset}
            style={{
              marginTop: 8, padding: '10px 20px', borderRadius: 12,
              background: '#4f46e5', color: '#fff', fontWeight: 500, border: 'none',
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
