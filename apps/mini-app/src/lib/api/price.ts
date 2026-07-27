import { apiFetch } from './client';

/**
 * SOL 시세 조회 — 백엔드 /api/price/sol 프록시
 *
 * 백엔드가 Manifest SOL/USDC 오더북 중간가를 우선 사용하고,
 * 오더북이 비어있거나 에러 시 Jupiter Price API V3로 폴백합니다.
 * 이 엔드포인트는 인증 없이 퍼블릭 접근 가능합니다.
 */

export interface SolPriceData {
  /** SOL의 USD 환산 가격 */
  usdPrice: number;
  /** 24시간 변동률 (%) */
  change24hPct: number;
  /** 가격 출처 — 'manifest' (SOL/USDC 오더북) 또는 'jupiter' (폴백) */
  source?: 'manifest' | 'jupiter';
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
}

/**
 * SOL 현재가 + 24시간 변동율
 * 실패 시 null 반환 (UI는 fallback 사용)
 */
export async function fetchSolPrice(): Promise<SolPriceData | null> {
  try {
    // API returns { price, change24hPct, source, ... }
    const data = await apiFetch<any>('/price/sol');
    if (!data || typeof data.price !== 'number') return null;
    return {
      usdPrice: data.price,
      change24hPct: typeof data.change24hPct === 'number' ? data.change24hPct : 0,
      source: data.source,
      bestBid: data.bestBid,
      bestAsk: data.bestAsk,
      spread: data.spread,
    };
  } catch {
    return null;
  }
}
