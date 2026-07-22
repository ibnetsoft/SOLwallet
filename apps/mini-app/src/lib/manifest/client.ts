import { apiFetch } from '@/lib/api/client';

export interface OrderbookEntry {
  price: number;
  quantity: number;
}

export interface OrderbookResponse {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  spread?: number;
}

/**
 * Manifest 오더북 조회 — 서버 프록시 경유
 *
 * Manifest HTTP API에는 퍼블릭 orderbook 엔드포인트가 없으므로
 * 서버가 공식 SDK(@cks-systems/manifest-sdk)로 온체인 마켓 PDA에서
 * bids/asks를 읽어 반환합니다.
 */
export async function fetchOrderbook(tokenMint: string): Promise<OrderbookResponse> {
  try {
    return await apiFetch<OrderbookResponse>(`/orders/orderbook/${tokenMint}`);
  } catch {
    return { bids: [], asks: [], spread: 0 };
  }
}

/**
 * 현재가 (오더북 best bid/ask 중간가)
 */
export async function fetchCurrentPrice(tokenMint: string): Promise<number> {
  const orderbook = await fetchOrderbook(tokenMint);

  if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
    return 0;
  }

  const bestBid = Math.max(...orderbook.bids.map((b) => b.price));
  const bestAsk = Math.min(...orderbook.asks.map((a) => a.price));

  return (bestBid + bestAsk) / 2;
}
