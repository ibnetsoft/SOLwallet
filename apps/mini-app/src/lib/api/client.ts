import { clearAuthToken } from '@/lib/storage';
import { getMsg } from '@/lib/i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

/** 요청 타임아웃 (10초) */
const REQUEST_TIMEOUT = 10_000;

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
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

    // 401 — 토큰 만료 시 자동 로그아웃
    if (res.status === 401) {
      if (typeof window !== 'undefined') {
        clearAuthToken();
      }
      throw new Error(getMsg('error.authExpired'));
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      throw new Error(error.message || getMsg('error.apiFailed'));
    }

    const json: ApiResponse<T> = await res.json();

    if (!json.success) {
      throw new Error(json.message || getMsg('error.apiResponse'));
    }

    return json.data;
  } catch (err) {
    // 타임아웃
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(getMsg('error.timeout'));
    }
    // 네트워크 에러
    if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
      throw new Error(getMsg('error.network'));
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { API_BASE };
export type { ApiResponse };