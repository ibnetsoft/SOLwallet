const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

/**
 * API 응답 래퍼
 */
interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * fetch 래퍼 — auth token 자동 첨부
 */
async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  let token: string | null = null;
  if (typeof window !== 'undefined') {
    token = localStorage.getItem('solwallet_auth_token');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(error.message || 'API 요청에 실패했습니다.');
  }

  const json: ApiResponse<T> = await res.json();

  if (!json.success) {
    throw new Error(json.message || 'API 응답 오류');
  }

  return json.data;
}

export { apiFetch, API_BASE };
export type { ApiResponse };
