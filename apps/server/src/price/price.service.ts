import { Injectable, Logger } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { WSOL_MINT, USDT_MINT } from '@solwallet/config';

const SOL_MINT = WSOL_MINT;
const JUPITER_PRICE_URL = 'https://lite-api.jup.ag/price/v3';

export interface SolPriceResult {
  /** SOL의 USD 환산 가격 */
  price: number;
  /** 가격 출처 — 'manifest' (SOL/USDC 오더북) 또는 'jupiter' (폴백) */
  source: 'manifest' | 'jupiter';
  /** 24시간 변동률 (%) — Jupiter에서만 제공되므로 manifest일 땐 0 */
  change24hPct: number;
  /** Manifest 오더북 정보 (source === 'manifest'인 경우) */
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
}

interface JupiterPriceEntry {
  usdPrice?: number;
  priceChange24h?: number;
}

/**
 * SOL 시세 조회 서비스
 *
 * 우선 Manifest SOL/USDC 오더북의 중간가를 사용하고,
 * 오더북이 비어있거나 에러 발생 시 Jupiter Price API V3로 폴백합니다.
 *
 * Manifest 우선인 이유: 실제 거래 체결 기준 가격을 보여주어
 * 사용자가 홈에서 보는 가격과 Trade 체결 가격의 괴리를 줄이기 위함.
 */
@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);

  constructor(private readonly ordersService: OrdersService) {}

  /**
   * SOL 시세 조회 — Manifest SOL/USDC 오더북 중간가 (Jupiter 폴백)
   */
  async getSolPrice(): Promise<SolPriceResult> {
    // 1. Manifest SOL/USDT 오더북 시도
    try {
      const orderbook = await this.ordersService.getOrderbook(SOL_MINT, USDT_MINT);

      if (orderbook.bids.length > 0 && orderbook.asks.length > 0) {
        const bestBid = Math.max(...orderbook.bids.map((b) => b.price));
        const bestAsk = Math.min(...orderbook.asks.map((a) => a.price));
        const midPrice = (bestBid + bestAsk) / 2;
        const spread = bestAsk - bestBid;

        if (midPrice > 0) {
          // Manifest 오더북은 현재 호가창만 존재하므로 24h 내역이 없습니다.
          // 유저에게 유의미한 변동율을 보여주기 위해 Jupiter의 24h 변동율을 가져와 합성합니다.
          let change24hPct = 0;
          try {
            const jup = await this.getSolPriceFromJupiter();
            change24hPct = jup.change24hPct;
          } catch (e) {
            this.logger.debug('Failed to fetch 24h pct from Jupiter for manifest fallback');
          }

          return {
            price: midPrice,
            source: 'manifest',
            change24hPct,
            bestBid,
            bestAsk,
            spread,
          };
        }
      }
      this.logger.debug('Manifest SOL/USDC orderbook empty — falling back to Jupiter');
    } catch (err) {
      this.logger.warn(
        `Manifest SOL/USDC orderbook failed: ${err instanceof Error ? err.message : String(err)} — falling back to Jupiter`,
      );
    }

    // 2. Jupiter 폴백
    return this.getSolPriceFromJupiter();
  }

  /**
   * Jupiter Price API V3 — 글로벌 종합 시장가
   */
  private async getSolPriceFromJupiter(): Promise<SolPriceResult> {
    const res = await fetch(`${JUPITER_PRICE_URL}?ids=${SOL_MINT}`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Jupiter price API failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as Record<string, JupiterPriceEntry>;
    const entry = data?.[SOL_MINT];

    if (!entry || typeof entry.usdPrice !== 'number') {
      throw new Error('Jupiter returned no SOL price');
    }

    return {
      price: entry.usdPrice,
      source: 'jupiter',
      change24hPct: typeof entry.priceChange24h === 'number' ? entry.priceChange24h : 0,
    };
  }
}
