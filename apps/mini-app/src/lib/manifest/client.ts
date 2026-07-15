import { MANIFEST } from '@solwallet/config';

const MANIFEST_BASE = MANIFEST.baseUrl;

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
 * Manifest 오더북 조회 (공개 API — 브라우저에서 직접 호출)
 */
export async function fetchOrderbook(tokenMint: string): Promise<OrderbookResponse> {
  const market = `${tokenMint}-So11111111111111111111111111111111111111112`;

  try {
    const res = await fetch(`${MANIFEST_BASE}/orders?market=${market}`);

    if (!res.ok) {
      return { bids: [], asks: [], spread: 0 };
    }

    return await res.json();
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
