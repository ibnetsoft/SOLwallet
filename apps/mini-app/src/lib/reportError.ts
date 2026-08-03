/**
 * 잡아서 처리한(uncaught가 아닌) 에러를 서버로 보고한다.
 *
 * app/error.tsx는 React 렌더링 중 발생한 uncaught 예외만 잡는다. try/catch로
 * 잡아서 사용자에게 친절한 메시지로 바꿔 보여주는 곳(서명 실패 등)은 실제
 * 원인이 브라우저 콘솔에만 남고 서버 로그에는 전혀 안 남아 원격으로 진단할
 * 방법이 없었다 — 이 함수로 그런 지점에서도 실제 원인을 서버에 남긴다.
 */
export function reportClientError(message: string, extra?: Record<string, unknown>): void {
  try {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';
    fetch(`${API_BASE}/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        stack: JSON.stringify(extra ?? {}),
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
    }).catch(() => {});
  } catch {
    // 리포팅 실패는 무시 — 사용자 흐름을 막지 않음
  }
}
