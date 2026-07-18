/**
 * SOL/USDT 시세 조회 — Jupiter Price API V3 (공개, 무료, 변동율 포함)
 * 응답 예:
 * {
 *   "So11111111111111111111111111111111111111112": {
 *     "usdPrice": 175.32,
 *     "priceChange24h": 2.34,
 *     ...
 *   }
 * }
 */

export interface SolPriceData {
  usdPrice: number;
  change24hPct: number;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * SOL 현재가 + 24시간 변동율
 * 실패 시 null 반환 (UI는 fallback 사용)
 */
export async function fetchSolPrice(): Promise<SolPriceData | null> {
  try {
    const res = await fetch(
      `https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;

    const data = await res.json();
    const entry = data?.[SOL_MINT];
    if (!entry || typeof entry.usdPrice !== 'number') return null;

    return {
      usdPrice: entry.usdPrice,
      change24hPct: typeof entry.priceChange24h === 'number' ? entry.priceChange24h : 0,
    };
  } catch {
    return null;
  }
}
