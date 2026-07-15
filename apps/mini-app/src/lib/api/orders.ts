import { apiFetch } from './client';

export interface CreateOrderParams {
  tokenId: string;
  walletId: string;
  side: 'buy' | 'sell';
  price: string;
  quantity: string;
}

export interface CreateOrderResult {
  order: Record<string, unknown>;
  unsignedTx: string;
}

/**
 * 주문 생성
 */
export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  return apiFetch('/orders', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * 서명된 트랜잭션 제출
 */
export async function submitOrder(orderId: string, signedTx: string): Promise<{ txSignature: string }> {
  return apiFetch(`/orders/${orderId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ signedTx }),
  });
}

/**
 * 주문 취소
 */
export async function cancelOrder(orderId: string): Promise<{ success: boolean }> {
  return apiFetch(`/orders/${orderId}/cancel`, {
    method: 'POST',
  });
}

/**
 * 활성 주문 목록
 */
export async function getActiveOrders(): Promise<Record<string, unknown>[]> {
  const res = await apiFetch<Record<string, unknown>[]>('/orders/active');
  return Array.isArray(res) ? res : [];
}

/**
 * 과거 주문 내역
 */
export async function getOrderHistory(): Promise<Record<string, unknown>[]> {
  const res = await apiFetch<Record<string, unknown>[]>('/orders/history');
  return Array.isArray(res) ? res : [];
}
