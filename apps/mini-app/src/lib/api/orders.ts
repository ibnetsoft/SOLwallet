import { apiFetch } from './client';

export interface CreateOrderParams {
  tokenId: string;
  walletId: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  orderType?: 'limit' | 'market';
}

export interface CreateOrderResult {
  order: Record<string, unknown>;
  unsignedTx: string;
  /** 첫 거래 전 필요한 ATA 생성 트랜잭션 (없으면 undefined) */
  setupTx?: string;
}

/**
 * 주문 생성 (1단계: unsigned tx 반환)
 */
export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  return apiFetch('/orders', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * 서명된 주문 트랜잭션 제출 (2단계)
 */
export async function submitOrder(orderId: string, signedTx: string): Promise<{ txSignature: string }> {
  return apiFetch(`/orders/${orderId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ signedTx }),
  });
}

/**
 * 서명 직전 fresh unsigned tx 획득 — Manifest blockhash 만료 방지
 * createOrder로 주문을 생성한 후, 서명하기 직전에 이 함수를 호출하여
 * fresh blockhash가 포함된 최신 unsigned tx를 가져옵니다.
 */
export async function getFreshTx(orderId: string): Promise<{ unsignedTx: string }> {
  return apiFetch(`/orders/${orderId}/fresh-tx`, { method: 'POST' });
}

/**
 * SOL 매도 시 fresh wSOL 래핑 tx 획득 — 서명 직전 fresh blockhash로 생성
 * SOL 매도 주문에서 createOrder 후, 서명하기 직전 이 함수를 호출
 */
export async function getWrapTx(orderId: string): Promise<{ wrapTx: string }> {
  return apiFetch(`/orders/${orderId}/wrap-tx`, { method: 'POST' });
}

/**
 * ATA setup 트랜잭션 제출 (첫 거래 전 토큰 계정 생성)
 */
export async function submitSetupTx(signedTx: string): Promise<{ txSignature: string }> {
  return apiFetch('/orders/setup/submit', {
    method: 'POST',
    body: JSON.stringify({ signedTx }),
  });
}

/**
 * wSOL 래핑 트랜잭션 제출 + 컨펌 확인
 */
export async function submitWrapTx(signedTx: string): Promise<{ txSignature: string }> {
  return apiFetch('/orders/wrap/submit', {
    method: 'POST',
    body: JSON.stringify({ signedTx }),
  });
}

/**
 * Manifest 잔액 인출 tx 획득 (fresh blockhash)
 * 체결된 수익(USDC 등)을 Manifest Global account에서 사용자 ATA로 인출
 */
export async function getWithdrawTx(walletId: string): Promise<{ unsignedTx: string }> {
  return apiFetch('/orders/withdraw-tx', {
    method: 'POST',
    body: JSON.stringify({ walletId }),
  });
}

/**
 * 서명된 인출 트랜잭션 제출 + 컨펌
 */
export async function submitWithdrawTx(signedTx: string): Promise<{ txSignature: string }> {
  return apiFetch('/orders/withdraw/submit', {
    method: 'POST',
    body: JSON.stringify({ signedTx }),
  });
}

/**
 * 주문 취소 — 1단계: unsigned cancel tx 반환
 */
export async function cancelOrder(orderId: string): Promise<{ order: Record<string, unknown>; unsignedTx: string }> {
  return apiFetch(`/orders/${orderId}/cancel`, {
    method: 'POST',
  });
}

/**
 * 취소 서명 직전 fresh unsigned cancel tx 획득 — Manifest blockhash 만료 방지
 * 주문이 온체인에 없으면 cancelled:true 로 DB 삭제 후 반환
 */
export async function getFreshCancelTx(orderId: string): Promise<{ unsignedTx?: string; cancelled?: boolean }> {
  return apiFetch(`/orders/${orderId}/cancel/fresh-tx`, { method: 'POST' });
}

/**
 * 주문 취소 — 2단계: 서명된 cancel tx 제출
 */
export async function submitCancelOrder(orderId: string, signedTx: string): Promise<{ txSignature: string }> {
  return apiFetch(`/orders/${orderId}/cancel/submit`, {
    method: 'POST',
    body: JSON.stringify({ signedTx }),
  });
}

/**
 * 활성 주문 목록
 */
export async function getActiveOrders(): Promise<Record<string, unknown>[]> {
  const res = await apiFetch<Record<string, unknown>[]>('/orders/active');
  return Array.isArray(res) ? res : [];
}

export interface OrderHistoryPage {
  items: Record<string, unknown>[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * 과거 주문 내역 (cursor 페이지네이션)
 * @param before — ISO 시각. 이 값보다 이전 주문만 반환 (첫 페이지는 생략)
 */
export async function getOrderHistory(before?: string): Promise<OrderHistoryPage> {
  const params = before ? `?before=${encodeURIComponent(before)}` : '';
  const res = await apiFetch<OrderHistoryPage>(`/orders/history${params}`);
  // 구버전 응답(배열) 호환
  if (Array.isArray(res)) {
    return { items: res, hasMore: false, nextCursor: null };
  }
  return res;
}
