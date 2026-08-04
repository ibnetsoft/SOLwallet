import { clearAuthToken } from '@/lib/storage';
import { getMsg } from '@/lib/i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

/**
 * 요청 타임아웃 (45초) — 거래 제출/확인은 RPC 응답 대기로 오래 걸릴 수 있음.
 * 서버의 온체인 컨펌 대기(confirmTransactionInitialTimeout: 30초)보다 충분히 길게 잡아야
 * 서버가 컨펌 결과를 반환하기 전에 클라이언트가 먼저 요청을 중단해버리는 레이스를 방지함.
 */
const REQUEST_TIMEOUT = 45_000;

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * 서버 에러 응답을 그대로 담는 커스텀 에러 — code 필드로 심각도 분류 가능.
 *
 * code는 서버가 에러 응답에 포함시키는 머신 리더블 식별자:
 *   INSUFFICIENT_SOL  — SOL 가스/렌트 부족 (사용자 조치 가능)
 *   MARKET_NOT_READY  — 신규 상장 토큰 (재시도 가능)
 *   TX_EXPIRED        — 블록해시 만료 (재시도 가능)
 *   SETUP_FAILED      — 거래 준비 실패 (재시도 가능)
 *   CONFIRM_TIMEOUT   — 컨펌 지연 (재시도 가능)
 *   (없음)            — 일반 실패 (심각)
 */
export class ApiError extends Error {
  code?: string;
  statusCode?: number;

  constructor(message: string, code?: string, statusCode?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * API fetch 래퍼 — auth token 자동 첨부, 타임아웃, 401 처리
 */
export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  let token: string | null = null;
  if (typeof window !== 'undefined') {
    token = localStorage.getItem('solwallet_auth_token');
  }

  // 타임아웃 처리를 위한 AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
      signal: controller.signal,
    });

    // 401 — 토큰 만료/무효(삭제된 유저 등) 시 자동 로그아웃 + 재로그인 유도.
    // 토큰만 지우고 리다이렉트를 안 하면, 사용자가 같은 화면에서 재시도할 때
    // 토큰 없이 요청이 나가 "인증 토큰이 필요합니다" 같은 다른 에러로 이어짐.
    if (res.status === 401) {
      if (typeof window !== 'undefined') {
        clearAuthToken();
        window.location.href = '/login';
      }
      throw new ApiError(getMsg('error.authExpired'), 'AUTH_EXPIRED', 401);
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      throw new ApiError(
        error.message || getMsg('error.apiFailed'),
        error.code,
        res.status,
      );
    }

    const json: ApiResponse<T> = await res.json();

    if (!json.success) {
      throw new ApiError(
        json.message || getMsg('error.apiResponse'),
        (json as { code?: string }).code,
        res.status,
      );
    }

    return json.data;
  } catch (err) {
    // 이미 ApiError면 그대로 전달 (code 보존)
    if (err instanceof ApiError) throw err;
    // 타임아웃
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(getMsg('error.timeout'), 'TIMEOUT');
    }
    // 네트워크 에러
    if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
      throw new ApiError(getMsg('error.network'), 'NETWORK');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { API_BASE };
export type { ApiResponse };
