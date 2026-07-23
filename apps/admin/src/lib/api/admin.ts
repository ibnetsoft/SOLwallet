import { apiFetch, API_BASE } from './client';
import type { AdminStats, AdminUserDetail, AdminTokenDetail, AdminOrderDetail } from '@solwallet/shared-types';

// ─── 대시보드 ───

export function getStats(): Promise<AdminStats> {
  return apiFetch('/admin/stats');
}

// ─── 유저 관리 ───

export function getUsers(page = 1, pageSize = 20): Promise<{ users: AdminUserDetail[]; total: number }> {
  return apiFetch(`/admin/users?page=${page}&pageSize=${pageSize}`);
}

export interface AdminWalletDetail {
  id: string;
  userId: string;
  publicKey: string;
  walletIndex: number;
  label: string;
  isActive: boolean;
  createdAt: string;
}

export function getUserWallets(userId: string): Promise<AdminWalletDetail[]> {
  return apiFetch(`/admin/users/${userId}/wallets`);
}

// ─── 추천(방장) 통계 ───

export interface ReferralStat {
  referrerId: string;
  referrerName: string;
  weeklyCount: number;
  totalCount: number;
}

/**
 * 방장 7일 실적 리더보드
 * GET /admin/referrals/stats
 */
export function getReferralStats(): Promise<ReferralStat[]> {
  return apiFetch('/admin/referrals/stats');
}

// ─── 추천 조직도 ───

export function getReferralTree(userId: string, maxDepth = 5) {
  return apiFetch(`/admin/referrals/tree?userId=${userId}&maxDepth=${maxDepth}`);
}

export function getReferralRoots() {
  return apiFetch('/admin/referrals/roots');
}

// ─── 토큰 관리 ───

export function getTokens(): Promise<AdminTokenDetail[]> {
  return apiFetch('/admin/tokens');
}

export function createToken(dto: { mintAddress: string; symbol: string; decimals: number }): Promise<Record<string, unknown>> {
  return apiFetch('/admin/tokens', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function toggleToken(tokenId: string): Promise<Record<string, unknown>> {
  return apiFetch(`/admin/tokens/${tokenId}`, {
    method: 'PATCH',
  });
}

export function deleteToken(tokenId: string): Promise<Record<string, unknown>> {
  return apiFetch(`/admin/tokens/${tokenId}`, {
    method: 'DELETE',
  });
}

/**
 * 토큰 로고 이미지 업로드 (PNG) — multipart/form-data
 * 저장 규칙: token-logos/{symbol-lowercase}.png
 */
export async function uploadTokenLogo(symbol: string, file: File): Promise<{ logoUrl: string }> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_auth_token') : null;
  const form = new FormData();
  form.append('file', file);
  form.append('symbol', symbol);

  const res = await fetch(`${API_BASE}/admin/tokens/logo`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    // multipart: Content-Type 자동 설정 (직접 지정 X — boundary 필요)
    body: form,
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('admin_auth_token');
      window.location.href = '/login';
    }
    throw new Error('인증이 만료되었습니다.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || '로고 업로드 실패');
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.message || '로고 업로드 실패');
  }
  return json.data as { logoUrl: string };
}

// ─── 주문 관리 ───

export function getOrders(options: { status?: string; tokenId?: string; page?: number; pageSize?: number } = {}): Promise<{ orders: AdminOrderDetail[]; total: number }> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.tokenId) params.set('tokenId', options.tokenId);
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  return apiFetch(`/admin/orders?${params.toString()}`);
}

// ─── 수수료 정산 대장 ───

export interface RevenueEntry {
  orderId: string;
  fee: string | number;
  feeRate: string | number;
  side: string;
  price: string | number;
  quantity: string | number;
  tradeAmount: number;
  txSignature: string | null;
  status: string;
  createdAt: string;
  username: string;
  telegramUid?: number;
  tokenSymbol: string;
}

export function getRevenue(page = 1, pageSize = 50): Promise<{ ledger: RevenueEntry[]; total: number; totalRevenue: number }> {
  return apiFetch(`/admin/revenue?page=${page}&pageSize=${pageSize}`);
}

// ─── 설정 관리 ───

export function getFeeRate(): Promise<{ feeRate: number }> {
  return apiFetch('/admin/settings/fee-rate');
}

export function updateFeeRate(feeRate: number): Promise<{ feeRate: number }> {
  return apiFetch('/admin/settings/fee-rate', {
    method: 'PATCH',
    body: JSON.stringify({ feeRate }),
  });
}
