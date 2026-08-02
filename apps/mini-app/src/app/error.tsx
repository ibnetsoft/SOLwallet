'use client';

import { useEffect } from 'react';

/**
 * 라우트 세그먼트(레이아웃 하위) 렌더링 중 발생한 예외를 잡는다.
 * 예전엔 이런 에러가 나면 "Application error: a client-side exception has occurred"라는
 * 원인 불명의 화면만 뜨고 서버에는 아무 기록도 안 남았다 — 여기서 서버로 스택을 보내
 * docker logs만 보고도 원인을 바로 찾을 수 있게 한다.
 */
export default function Error({
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
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-gray-950 text-white">
      <p className="text-lg font-bold">일시적인 오류가 발생했습니다</p>
      <p className="text-sm text-gray-400">문제가 계속되면 잠시 후 다시 시도해주세요.</p>
      <button
        onClick={reset}
        className="mt-2 px-5 py-2.5 rounded-xl bg-primary-600 text-white font-medium"
      >
        다시 시도
      </button>
    </div>
  );
}
