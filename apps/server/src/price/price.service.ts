import { Injectable, Logger } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { SupabaseService } from '../supabase/supabase.service';
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

  /** 민트별 시세 캐시 — 잔액 조회가 지갑당 토큰 개수만큼 이 메서드를 호출하므로 캐시 없인 폴링 부하가 배가됨 */
  private readonly tokenPriceCache = new Map<string, { price: number; ts: number }>();
  private readonly TOKEN_PRICE_TTL_MS = 30_000;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * 임의 SPL 토큰의 USDT 환산 시세 — 우리 DB에 기록된 최근 체결가(마지막 filled 주문의 price)
   *
   * 오더북 최우선호가 중간값은 처음에 써봤으나, DUDE처럼 유동성이 거의 없는 마켓에서는
   * 먼지 수량 호가 하나만으로도 자산가치가 실제와 무관하게 폭등하는 문제가 있었다
   * (bestBid $1 vs bestAsk $19 → mid $10, 실제로는 그 가격에 아무도 사고팔 수 없음).
   * 실제로 누군가 그 가격에 체결시킨 적이 있는 최근 체결가가 훨씬 신뢰할 수 있다.
   *
   * 체결 이력이 없으면(신규 상장 직후 등) Manifest 오더북 중간가로 폴백한다.
   * 거래 화면용 getTradePrice()와 동일한 로직을 내부에서 재사용하여 중복을 제거한다.
   *
   * 30초 캐시로 홈 화면 잔액 폴링(10초 주기 × 보유 토큰 수)이 그대로 DB 조회로
   * 증폭되는 것을 막는다. 단 price=0은 5초만 캐시하여 빠르게 재조회하게 한다.
   */
  async getTokenPrice(mintAddress: string): Promise<number> {
    const cached = this.tokenPriceCache.get(mintAddress);
    if (cached && Date.now() - cached.ts < this.TOKEN_PRICE_TTL_MS) {
      return cached.price;
    }

    let price = 0;
    try {
      const { data: token } = await this.client
        .from('tokens')
        .select('id')
        .eq('mint_address', mintAddress)
        .maybeSingle();

      if (token) {
        const { data: lastFilled } = await this.client
          .from('orders')
          .select('price')
          .eq('token_id', token.id)
          .eq('status', 'filled')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        price = Number(lastFilled?.price ?? 0);

        // 체결 이력이 없으면 오더북 중간가로 폴백 (getTradePrice와 동일 로직)
        if (price === 0) {
          try {
            const orderbook = await this.ordersService.getOrderbook(mintAddress, USDT_MINT);
            const bestBid = orderbook.bids.length > 0 ? Math.max(...orderbook.bids.map((b) => b.price)) : 0;
            const bestAsk = orderbook.asks.length > 0 ? Math.min(...orderbook.asks.map((a) => a.price)) : 0;
            price = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0;
          } catch (err) {
            this.logger.debug(
              `Token price orderbook fallback failed for ${mintAddress.slice(0, 8)}...: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `Token price fetch failed for ${mintAddress.slice(0, 8)}...: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // price=0은 5초만 캐시하여 다음 폴링에서 빠르게 재조회
    const ttl = price > 0 ? this.TOKEN_PRICE_TTL_MS : 5_000;
    this.tokenPriceCache.set(mintAddress, { price, ts: Date.now() - (this.TOKEN_PRICE_TTL_MS - ttl) });
    return price;
  }

  /**
   * 거래 화면(시장가/현재가 표시)용 참고가
   *
   * getTokenPrice()가 이미 "최근 체결가 우선 + 오더북 중간가 폴백"을 수행하므로
   * 이 메서드는 getTokenPrice()를 위임 호출한다. trade 화면만의 별도 폴백 로직은
   * 더 이상 필요하지 않다.
   */
  async getTradePrice(mintAddress: string): Promise<number> {
    return this.getTokenPrice(mintAddress);
  }

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
