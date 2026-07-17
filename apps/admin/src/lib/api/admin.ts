import { apiFetch } from './client';
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

// ─── 주문 관리 ───

export function getOrders(options: { status?: string; tokenId?: string; page?: number; pageSize?: number } = {}): Promise<{ orders: AdminOrderDetail[]; total: number }> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.tokenId) params.set('tokenId', options.tokenId);
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  return apiFetch(`/admin/orders?${params.toString()}`);
}
