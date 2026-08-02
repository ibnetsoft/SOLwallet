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
export async function fetchOrderbook(tokenMint: string, quoteMint?: string): Promise<OrderbookResponse> {
  try {
    const query = quoteMint ? `?quoteMint=${quoteMint}` : '';
    return await apiFetch<OrderbookResponse>(`/orders/orderbook/${tokenMint}${query}`);
  } catch {
    return { bids: [], asks: [], spread: 0 };
  }
}

/**
 * 현재가 — 서버가 계산한 참고가(최근 체결가 우선, 체결 이력 없으면 오더북 중간값)
 *
 * 예전엔 여기서 직접 오더북 bestBid/bestAsk 중간값을 계산했는데, DUDE처럼
 * 유동성이 거의 없는 마켓에서는 먼지 호가 하나만으로 가격이 실제와 무관하게
 * 튀는 문제가 있었다(bestBid $1 vs bestAsk $19 → $10). 실제 체결가가 있으면
 * 그걸 우선하도록 서버 로직(PriceService.getTradePrice)에 위임한다.
 */
export async function fetchCurrentPrice(tokenMint: string, _quoteMint?: string): Promise<number> {
  try {
    const res = await apiFetch<{ price: number }>(`/price/token/${tokenMint}`);
    return res.price;
  } catch {
    return 0;
  }
}
