import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { USDT_MINT } from '@solwallet/config';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * 주문 체결 감지 서비스
 *
 * 1. submitted 주문: tx가 블록에 포함되었는지 확인 → active (orderbook 등록)
 * 2. active 주문: 체결 여부 2단계 확인
 *    a. 주문 제출 tx 로그에서 fill 이벤트 파싱 (즉시 self-cross 체결 감지)
 *       - Manifest는 tx 로그에 "Program data: <base64>"로 fill 이벤트를 기록
 *       - fillDiscriminant(8바이트)로 fill 이벤트 식별 후 FillLog 역직렬화
 *       - ⚠️ 이 방식은 "주문 제출 시점에 즉시 체결된" 경우만 감지 가능. 이후 다른
 *         트레이더의 매칭 트랜잭션으로 체결되는 일반적인 경우는 여기서 잡히지 않음
 *         (fill 이벤트가 상대방의 트랜잭션 로그에 기록되기 때문)
 *    b. a에서 못 잡은 경우, 온체인 오더북(Market 계정)을 직접 조회해 이 주문이
 *       여전히 resting order로 남아있는지 대조. 사라졌다면 체결된 것으로 판단
 */

interface SubmittedOrder {
  id: string;
  tx_signature: string;
  quantity: string | number;
  side: string;
  created_at: string;
  wallet_id?: string;
  token_id?: string;
  manifest_sequence_number?: number | string | null;
}

interface RpcTransactionResponse {
  meta?: {
    err?: unknown | null;
    logMessages?: string[];
  } | null;
  slot?: number;
  blockTime?: number | null;
}

/** Manifest SDK Market — 동적 import로만 사용하므로 필요한 형태만 구조적으로 정의 */
interface MarketLike {
  openOrders(): Array<{ trader: PublicKey; sequenceNumber: unknown }>;
}

@Injectable()
export class OrderStatusService {
  private readonly logger = new Logger(OrderStatusService.name);
  private readonly rpcUrl: string;

  /** submitted/active 주문을 타임아웃 처리할 기준 (1시간) */
  private readonly ORDER_TIMEOUT_MS = 60 * 60 * 1000;
  /** 단일 폴링에서 처리할 최대 주문 수 */
  private readonly BATCH_SIZE = 20;
  /** fill 이벤트 식별용 discriminant (Manifest SDK와 동일) */
  private fillDiscriminant: Buffer | null = null;
  private readonly connection: Connection;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') || '';
    this.connection = new Connection(this.rpcUrl);
  }

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * fillDiscriminant lazy 로드 — Manifest SDK fillFeed 서브모듈에서 가져옴
   */
  private async getFillDiscriminant(): Promise<Buffer> {
    if (this.fillDiscriminant) return this.fillDiscriminant;
    try {
      // fillDiscriminant는 최상위 export에 없고 fillFeed 서브모듈에 있음
      const fillFeed = await import('@cks-systems/manifest-sdk/dist/cjs/fillFeed') as { fillDiscriminant?: Buffer };
      if (fillFeed.fillDiscriminant) {
        this.fillDiscriminant = fillFeed.fillDiscriminant;
        this.logger.log(`[fillCheck] fillDiscriminant loaded: ${this.fillDiscriminant.toString('hex')}`);
        return this.fillDiscriminant;
      }
      throw new Error('fillDiscriminant not found in fillFeed exports');
    } catch (err) {
      this.logger.error(`[fillCheck] Failed to load fillDiscriminant: ${err instanceof Error ? err.message : String(err)}`);
      this.fillDiscriminant = Buffer.alloc(0);
      return this.fillDiscriminant;
    }
  }

  /**
   * submitted + active 주문의 체결 상태를 확인하고 DB 업데이트
   */
  async checkPendingOrders(): Promise<{ filled: number; failed: number; expired: number; pending: number }> {
    // submitted 주문: tx 블록 포함 확인
    await this.checkSubmittedOrders();

    // active 주문: 실제 체결(fill) 감지
    const result = await this.checkActiveOrders();

    return result;
  }

  /**
   * submitted 주문 처리 — tx가 블록에 포함되었는지 확인 → active
   */
  private async checkSubmittedOrders(): Promise<void> {
    const { data: orders, error } = await this.client
      .from('orders')
      .select('id, tx_signature, quantity, side, created_at')
      .eq('status', 'submitted')
      .not('tx_signature', 'is', null)
      .order('created_at', { ascending: false })
      .limit(this.BATCH_SIZE);

    if (error || !orders || orders.length === 0) return;

    for (const order of orders as unknown as SubmittedOrder[]) {
      const ageMs = Date.now() - new Date(order.created_at).getTime();
      if (ageMs > this.ORDER_TIMEOUT_MS) {
        await this.updateOrderStatus(order.id, 'expired');
        continue;
      }

      const result = await this.checkTransactionStatus(order.tx_signature);

      if (result === 'success') {
        // tx 성공 = orderbook에 등록 → active
        await this.updateOrderStatus(order.id, 'active');
        this.logger.log(`[submitted] order ${order.id} confirmed → active (orderbook registered)`);
      } else if (result === 'failed') {
        await this.updateOrderStatus(order.id, 'failed');
        this.logger.log(`[submitted] order ${order.id} tx failed → failed`);
      }
    }
  }

  /**
   * active 주문 처리 — 체결 여부 2단계 확인 (placement tx 로그 → 온체인 오더북 대조)
   */
  private async checkActiveOrders(): Promise<{ filled: number; failed: number; expired: number; pending: number }> {
    const { data: orders, error } = await this.client
      .from('orders')
      .select('id, tx_signature, quantity, side, created_at, wallet_id, token_id, manifest_sequence_number')
      .eq('status', 'active')
      .not('tx_signature', 'is', null)
      .order('created_at', { ascending: false })
      .limit(this.BATCH_SIZE);

    if (error || !orders || orders.length === 0) {
      return { filled: 0, failed: 0, expired: 0, pending: 0 };
    }

    // 온체인 오더북 대조용 — 지갑 public key / 토큰 mint 배치 조회
    const typedOrders = orders as unknown as SubmittedOrder[];
    const walletIds = Array.from(new Set(typedOrders.map((o) => o.wallet_id).filter((v): v is string => !!v)));
    const tokenIds = Array.from(new Set(typedOrders.map((o) => o.token_id).filter((v): v is string => !!v)));
    const walletMap: Record<string, string> = {};
    const tokenMap: Record<string, string> = {};

    if (walletIds.length > 0) {
      const { data: walletsData } = await this.client.from('wallets').select('id, public_key').in('id', walletIds);
      (walletsData || []).forEach((w) => { walletMap[w.id as string] = w.public_key as string; });
    }
    if (tokenIds.length > 0) {
      const { data: tokensData } = await this.client.from('tokens').select('id, mint_address').in('id', tokenIds);
      (tokensData || []).forEach((t) => { tokenMap[t.id as string] = t.mint_address as string; });
    }

    // 마켓 조회 결과를 폴링 1회 사이클 동안 캐시 (동일 마켓 중복 RPC 방지)
    const marketCache = new Map<string, MarketLike | null>();

    let filled = 0;
    let expired = 0;
    let pending = 0;

    for (const order of typedOrders) {
      const ageMs = Date.now() - new Date(order.created_at).getTime();
      const isOverTimeout = ageMs > this.ORDER_TIMEOUT_MS;

      // 1단계: 주문 제출 tx 로그에서 즉시 체결(self-cross) 여부 확인
      // ⚠️ 타임아웃 여부와 무관하게 항상 먼저 체결부터 확인한다 — 체결된 주문을
      //    "오래됐다"는 이유만으로 expired 처리해버리면 체결 사실 자체가 영영 묻힘
      const fillResult = await this.checkFillFromTxLogs(order.tx_signature, order.id);

      if (fillResult.filled) {
        const fillQty = fillResult.baseAtomsTokens ?? order.quantity;
        await this.updateOrderStatus(order.id, 'filled', fillQty);
        filled++;
        this.logger.log(
          `[active] order ${order.id} FILLED (tx log) — qty=${fillQty} quote=${fillResult.quoteAtomsTokens ?? 'N/A'}`,
        );
        continue;
      }

      // 2단계: placement tx에는 fill 이벤트가 없더라도, 이후 다른 트레이더의
      // 매칭 트랜잭션으로 체결됐을 수 있음 — 온체인 오더북에 이 주문이 여전히 남아있는지 대조
      const traderPubkey = order.wallet_id ? walletMap[order.wallet_id] : undefined;
      const baseMint = order.token_id ? tokenMap[order.token_id] : undefined;
      const sequenceNumber = order.manifest_sequence_number;
      let stillOpen: boolean | null = null;

      if (traderPubkey && baseMint && sequenceNumber != null) {
        stillOpen = await this.isOrderStillOpen(marketCache, baseMint, traderPubkey, Number(sequenceNumber));
        if (stillOpen === false) {
          // 오더북에서 사라짐 — 다른 트레이더에게 체결된 것으로 판단 (전량 체결 처리)
          await this.updateOrderStatus(order.id, 'filled', order.quantity);
          filled++;
          this.logger.log(`[active] order ${order.id} FILLED (vanished from on-chain book) — qty=${order.quantity}`);
          continue;
        }
      }

      // 여기까지 왔다면 체결 증거를 못 찾은 것 — 온체인에 여전히 남아있음(stillOpen===true)이
      // 확인됐거나, 마켓 조회 실패(stillOpen===null)로 판단 불가한 경우. 이때만 타임아웃 적용
      if (isOverTimeout) {
        await this.updateOrderStatus(order.id, 'expired');
        expired++;
        continue;
      }

      pending++;
    }

    if (filled + expired > 0) {
      this.logger.log(`[active] fill check: ${filled} filled, ${expired} expired, ${pending} pending`);
    }

    return { filled, failed: 0, expired, pending };
  }

  /**
   * 특정 주문(trader + sequenceNumber)이 온체인 오더북에 여전히 resting order로
   * 남아있는지 확인. 마켓 조회 결과는 인자로 받은 캐시에 저장해 동일 폴링
   * 사이클 내 중복 RPC 호출을 피한다.
   *
   * @returns true(아직 남아있음) / false(사라짐 — 체결로 추정) / null(조회 실패, 판단 보류)
   */
  private async isOrderStillOpen(
    marketCache: Map<string, MarketLike | null>,
    baseMintAddress: string,
    traderPubkey: string,
    sequenceNumber: number,
  ): Promise<boolean | null> {
    try {
      let market = marketCache.get(baseMintAddress);
      if (market === undefined) {
        const { Market } = await import('@cks-systems/manifest-sdk');
        const markets = await Market.findByMints(
          this.connection,
          new PublicKey(baseMintAddress),
          new PublicKey(USDT_MINT),
        );
        market = (markets && markets.length > 0 ? markets[0] : null) as unknown as MarketLike | null;
        marketCache.set(baseMintAddress, market);
      }
      if (!market) return null;

      return market.openOrders().some(
        (o) => o.trader.toBase58() === traderPubkey && Number(o.sequenceNumber) === sequenceNumber,
      );
    } catch (err) {
      this.logger.warn(`[fillCheck] Failed to check on-chain book: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * tx 로그에서 Manifest fill 이벤트 파싱
   *
   * Manifest는 "Program data: <base64>" 로그로 fill 이벤트를 기록.
   * base64 디코딩 후 첫 8바이트가 fillDiscriminant와 일치하면 fill.
   */
  private async checkFillFromTxLogs(
    signature: string,
    orderId: string,
  ): Promise<{ filled: boolean; checked: boolean; baseAtomsTokens?: number; quoteAtomsTokens?: number }> {
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [signature, { maxSupportedTransactionVersion: 0 }],
        }),
      });

      const data = await res.json() as { result?: RpcTransactionResponse | null; error?: { message?: string } };
      if (data.error || !data.result) {
        return { filled: false, checked: false };
      }

      const logs = data.result.meta?.logMessages;
      if (!logs) {
        return { filled: false, checked: false };
      }

      const discriminant = await this.getFillDiscriminant();

      // discriminant 로드 실패 시 fill 감지 불가 — 미체결로 처리
      if (discriminant.length === 0) {
        return { filled: false, checked: true };
      }

      // "Program data: <base64>" 항목에서 fill 이벤트 찾기
      for (const log of logs) {
        if (!log.startsWith('Program data: ')) continue;

        const base64Data = log.split(' ')[2];
        if (!base64Data) continue;

        try {
          const buffer = Buffer.from(base64Data, 'base64');

          // 첫 8바이트가 fillDiscriminant와 일치하는지 확인
          if (!buffer.subarray(0, 8).equals(discriminant)) continue;

          // fill 이벤트 발견 — FillLog 역직렬화
          const { FillLog } = await import('@cks-systems/manifest-sdk/dist/cjs/manifest/accounts/FillLog');
          const fillLog = FillLog.deserialize(buffer.subarray(8))[0];

          // baseAtoms / quoteAtoms를 토큰 단위로 변환
          // bignum일 수 있으므로 안전하게 숫자로 변환
          const toNumber = (v: { toString?: () => string } | number | bigint): number => {
            if (typeof v === 'number') return v;
            if (typeof v === 'bigint') return Number(v);
            return Number(v?.toString?.() ?? 0);
          };
          const baseAtoms = toNumber(fillLog.baseAtoms as never);
          const quoteAtoms = toNumber(fillLog.quoteAtoms as never);
          // SOL = 9 decimals, USDC = 6 decimals
          const baseAtomsTokens = baseAtoms / 1e9;
          const quoteAtomsTokens = quoteAtoms / 1e6;

          return {
            filled: true,
            checked: true,
            baseAtomsTokens,
            quoteAtomsTokens,
          };
        } catch {
          // 역직렬화 실패 — 다음 로그 확인
          continue;
        }
      }

      // fill 이벤트 없음 — 미체결 (orderbook에 있음)
      return { filled: false, checked: true };
    } catch (err) {
      this.logger.error(`[fillCheck] Failed for ${orderId}: ${err instanceof Error ? err.message : String(err)}`);
      return { filled: false, checked: false };
    }
  }

  /**
   * 단일 트랜잭션의 성공/실패 확인
   * @returns 'success' | 'failed' | 'pending'
   */
  private async checkTransactionStatus(signature: string): Promise<'success' | 'failed' | 'pending'> {
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [signature, { maxSupportedTransactionVersion: 0 }],
        }),
      });

      const data = await res.json() as { result?: RpcTransactionResponse | null; error?: { message?: string } };

      if (data.error) {
        this.logger.warn(`RPC getTransaction error for ${signature}: ${data.error.message}`);
        return 'pending';
      }

      const tx = data.result;
      if (!tx) {
        return 'pending';
      }

      if (tx.meta?.err) {
        this.logger.warn(`Transaction ${signature} failed: ${JSON.stringify(tx.meta.err)}`);
        return 'failed';
      }

      return 'success';
    } catch (err) {
      this.logger.error(`Failed to check tx ${signature}: ${err instanceof Error ? err.message : String(err)}`);
      return 'pending';
    }
  }

  /**
   * 주문 상태 업데이트
   */
  private async updateOrderStatus(orderId: string, status: string, filledQty?: string | number) {
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'filled' && filledQty !== undefined) {
      update.filled_qty = filledQty;
    }

    const { error } = await this.client
      .from('orders')
      .update(update)
      .eq('id', orderId);

    if (error) {
      this.logger.error(`Failed to update order ${orderId} to ${status}: ${error.message}`);
    }
  }
}
