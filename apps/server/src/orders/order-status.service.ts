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
  user_id?: string;
}

/** 온체인 오더북에서 주문 매칭에 사용하는 정보 */
interface ChainOrderInfo {
  sequenceNumber: string;
  lastValidSlot: number;
  trader: string;
}

/** 토큰별로 그룹화된 온체인 마켓 데이터 */
interface MarketCache {
  /** sequenceNumber → ChainOrderInfo */
  ordersBySeq: Map<string, ChainOrderInfo>;
}

interface RpcTransactionResponse {
  meta?: {
    err?: unknown | null;
    logMessages?: string[];
  } | null;
  slot?: number;
  blockTime?: number | null;
}

/** Manifest SDK Market 타입 — 동적 import로만 사용하므로 필요한 형태만 구조적으로 정의 */

/**
 * Manifest 프로그램 로그 discriminant (8바이트, hex).
 *
 * genAccDiscriminator("manifest::logs::XXX") = keccak256(name)의 첫 8바이트.
 * SDK의 lazy import가 실패하면 fill 감지 자체가 불가능해지므로(과거에 이것이
 * 원인이 되어 모든 주문이 가짜 체결로 분류됨), 검증된 값을 상수로 하드코딩한다.
 *
 *   FillLog:      3ae6f2034b7104a9  ← 실제 체결(매칭 성사) 이벤트
 *   PlaceOrderLog: 9d76f7d52f13a478  ← 주문 접수(오픈 오더 등록) 이벤트
 */
const FILL_DISCRIMINANT = Buffer.from('3ae6f2034b7104a9', 'hex');
const PLACE_ORDER_DISCRIMINANT = Buffer.from('9d76f7d52f13a478', 'hex');

@Injectable()
export class OrderStatusService {
  private readonly logger = new Logger(OrderStatusService.name);
  private readonly rpcUrl: string;

  /** pending인데 tx_signature가 끝내 안 채워진 고아 주문 정리 기준 (5분) —
   *  정상적인 서명·제출은 수십 초 내로 끝나므로 충분히 넉넉한 값.
   *  ⚠️ Manifest 지정가 주문은 체인에서 만료되지 않으므로, tx_signature가 있는
   *     정상 오픈 주문은 임의로 만료시키지 않는다 (사용자가 취소하기 전까지 활성). */
  private readonly PENDING_ORPHAN_TIMEOUT_MS = 5 * 60 * 1000;
  /** 단일 폴링에서 처리할 최대 주문 수 */
  private readonly BATCH_SIZE = 100;
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
   * 주문 제출(placement) tx 로그에서 Manifest가 부여한 orderSequenceNumber를 추출.
   * DB에 manifest_sequence_number가 없으면 저장. lastValidSlot도 함께 반환.
   */
  private async extractOrderSequenceNumber(
    signature: string,
    orderId?: string,
  ): Promise<{ seq: number | null; lastValidSlot: number | null }> {
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
      const data = await res.json() as { result?: RpcTransactionResponse | null };
      const logs = data.result?.meta?.logMessages;
      if (!logs) return { seq: null, lastValidSlot: null };

      for (const log of logs) {
        if (!log.startsWith('Program data: ')) continue;
        const base64Data = log.split(' ')[2];
        if (!base64Data) continue;

        try {
          const buffer = Buffer.from(base64Data, 'base64');
          if (!buffer.subarray(0, 8).equals(PLACE_ORDER_DISCRIMINANT)) continue;

          const { PlaceOrderLog } = await import('@cks-systems/manifest-sdk/dist/cjs/manifest/accounts/PlaceOrderLog');
          const placeLog = PlaceOrderLog.deserialize(buffer.subarray(8))[0];
          const seq = Number(placeLog.orderSequenceNumber.toString());
          const lvs = Number(placeLog.lastValidSlot);
          const seqValid = Number.isFinite(seq) ? seq : null;

          // DB에 sequence number가 없으면 저장
          if (seqValid != null && orderId) {
            const { error: seqError } = await this.client
              .from('orders')
              .update({ manifest_sequence_number: seqValid })
              .eq('id', orderId);
            if (seqError) {
              this.logger.warn(`[extractSeq] Failed to save seq for ${orderId}: ${seqError.message}`);
            }
          }

          return { seq: seqValid, lastValidSlot: Number.isFinite(lvs) ? lvs : null };
        } catch {
          continue;
        }
      }
      return { seq: null, lastValidSlot: null };
    } catch (err) {
      this.logger.warn(`[fillCheck] Failed to extract sequence number for ${signature}: ${err instanceof Error ? err.message : String(err)}`);
      return { seq: null, lastValidSlot: null };
    }
  }

  /**
   * submitted + active 주문의 체결 상태를 확인하고 DB 업데이트
   */
  async checkPendingOrders(): Promise<{ filled: number; failed: number; expired: number; pending: number }> {
    // pending 고아 주문: 클라이언트가 서명·제출에 끝내 실패한 경우 정리
    await this.checkOrphanedPendingOrders();

    // submitted 주문: tx 블록 포함 확인
    await this.checkSubmittedOrders();

    // active 주문: 실제 체결(fill) 감지
    const result = await this.checkActiveOrders();

    return result;
  }

  /**
   * 일회성 과거 주문 복구 — 잘못 분류된 주문 상태를 온체인 실제 상태와 맞춤.
   *
   * 어드민에서 수동 실행 (POST /api/admin/orders/reconcile).
   * - expired/failed 주문 중 FillEvent가 있는 것 → filled로 복구
   * - active 주문 중 온체인에서 사라진 것 → cancelled/expired로 보정
   * - active 주문 중 FillEvent가 있는 것 → filled로 보정
   */
  async reconcilePastOrders(): Promise<{ checked: number; recovered: number; corrected: number }> {
    const results = { checked: 0, recovered: 0, corrected: 0 };

    // ── 1. expired/failed 주문 복구 (FillEvent 확인) ──
    const { data: pastOrders, error: pastError } = await this.client
      .from('orders')
      .select('id, status, tx_signature, quantity')
      .in('status', ['expired', 'failed'])
      .not('tx_signature', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);

    if (!pastError && pastOrders && pastOrders.length > 0) {
      for (const order of pastOrders) {
        results.checked++;
        const fillResult = await this.checkFillFromTxLogs(order.tx_signature as string, order.id as string);

        if (fillResult.filled) {
          const fillQty = Number.isFinite(fillResult.baseAtomsTokens)
            ? fillResult.baseAtomsTokens
            : (order.quantity as number);
          await this.updateOrderStatus(order.id as string, 'filled', fillQty);
          results.recovered++;
          this.logger.log(`[reconcile] order ${order.id} recovered: ${order.status} → filled (FillEvent confirmed)`);
        }
      }
    }

    // ── 2. active 주문 온체인 대조 보정 ──
    const { data: activeOrders, error: activeError } = await this.client
      .from('orders')
      .select('id, tx_signature, quantity, created_at, token_id, manifest_sequence_number')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(200);

    if (!activeError && activeOrders && activeOrders.length > 0) {
      // token별로 그룹화하여 마켓 로드 최적화
      const ordersByToken = new Map<string, typeof activeOrders>();
      for (const order of activeOrders) {
        const tid = order.token_id as string;
        if (!tid) continue;
        if (!ordersByToken.has(tid)) ordersByToken.set(tid, []);
        ordersByToken.get(tid)!.push(order);
      }

      for (const [tokenId, tokenOrders] of ordersByToken) {
        let marketCache: MarketCache | null = null;
        try {
          marketCache = await this.loadMarketCache(tokenId);
        } catch (err) {
          this.logger.warn(`[reconcile] 마켓 로드 실패 token=${tokenId}: ${err instanceof Error ? err.message : String(err)}`);
        }

        for (const order of tokenOrders) {
          results.checked++;

          if (!order.tx_signature) {
            await this.updateOrderStatus(order.id, 'failed');
            results.corrected++;
            this.logger.log(`[reconcile] order ${order.id}: active → failed (no tx_signature)`);
            continue;
          }

          // sequenceNumber 추출
          let seqNum = order.manifest_sequence_number;
          if (seqNum == null) {
            const { seq } = await this.extractOrderSequenceNumber(order.tx_signature, order.id);
            if (seq != null) seqNum = seq;
          }

          if (seqNum == null || !marketCache) {
            // seq 추출 불가 → FillEvent만 확인
            const fillResult = await this.checkFillFromTxLogs(order.tx_signature, order.id);
            if (fillResult.filled) {
              const fillQty = Number.isFinite(fillResult.baseAtomsTokens) ? fillResult.baseAtomsTokens : (order.quantity as number);
              await this.updateOrderStatus(order.id, 'filled', fillQty);
              results.corrected++;
              results.recovered++;
              this.logger.log(`[reconcile] order ${order.id}: active → filled (FillEvent, seq 없음)`);
            } else if (seqNum == null) {
              await this.updateOrderStatus(order.id, 'cancelled');
              results.corrected++;
              this.logger.log(`[reconcile] order ${order.id}: active → cancelled (PlaceOrderLog 없음)`);
            }
            continue;
          }

          // 온체인 매칭
          const onChainOrder = marketCache.ordersBySeq.get(String(seqNum));
          if (onChainOrder) {
            // 만료 확인
            if (onChainOrder.lastValidSlot > 0) {
              const currentSlot = await this.getCurrentSlot();
              if (currentSlot > 0 && onChainOrder.lastValidSlot < currentSlot) {
                await this.updateOrderStatus(order.id, 'expired');
                results.corrected++;
                this.logger.log(`[reconcile] order ${order.id}: active → expired (lvs=${onChainOrder.lastValidSlot})`);
              }
            }
            // 정상 active → 변경 없음
          } else {
            // 온체인에서 사라짐 → FillEvent 확인
            const fillResult = await this.checkFillFromTxLogs(order.tx_signature, order.id);
            if (fillResult.filled) {
              const fillQty = Number.isFinite(fillResult.baseAtomsTokens) ? fillResult.baseAtomsTokens : (order.quantity as number);
              await this.updateOrderStatus(order.id, 'filled', fillQty);
              results.corrected++;
              results.recovered++;
              this.logger.log(`[reconcile] order ${order.id}: active → filled (FillEvent confirmed)`);
            } else {
              await this.updateOrderStatus(order.id, 'cancelled');
              results.corrected++;
              this.logger.log(`[reconcile] order ${order.id}: active → cancelled (vanished, no FillEvent)`);
            }
          }
        }
      }
    }

    this.logger.log(`[reconcile] checked ${results.checked}, recovered ${results.recovered} to filled, corrected ${results.corrected} statuses`);
    return results;
  }

  /**
   * 서명·제출이 끝내 안 된 고아 주문 정리 — status='failed'로 전환.
   *
   * createOrder는 DB에 status='pending'으로 주문을 만들고, Manifest가 unsigned tx
   * 생성 요청을 받아주면 status='active'로 바꾼다. 클라이언트 서명 실패·네트워크
   * 끊김·앱 종료로 submitOrder가 안 불리면 tx_signature가 null인 채 active로 남는다.
   *
   * ⚠️ 온체인 오더북 대조로 체결 여부를 추론하지 않는다 — "오더북에 없으면 체결"은
   * 취소/만료/부분체결과 구분이 안 되어 가짜 체결을 양산한다. 실제 체결은
   * checkActiveOrders의 FillEvent 파싱으로만 확정한다.
   */
  private async checkOrphanedPendingOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - this.PENDING_ORPHAN_TIMEOUT_MS).toISOString();
    const { data: orphans, error } = await this.client
      .from('orders')
      .select('id, created_at')
      .in('status', ['pending', 'active'])
      .is('tx_signature', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(this.BATCH_SIZE);

    if (error || !orphans || orphans.length === 0) return;

    for (const order of orphans) {
      await this.updateOrderStatus(order.id as string, 'failed');
    }
    this.logger.warn(`[pending] ${orphans.length}개 고아 주문(서명/제출 미완료) → failed 처리`);
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
      const result = await this.checkTransactionStatus(order.tx_signature);

      if (result === 'success') {
        // tx 성공 = orderbook에 등록 → active
        await this.updateOrderStatus(order.id, 'active');

        // 체결 감지에 필요한 orderSequenceNumber를 placement tx 로그에서 확보
        const { seq } = await this.extractOrderSequenceNumber(order.tx_signature, order.id);
        if (seq != null) {
          this.logger.log(`[submitted] order ${order.id} confirmed → active (seq=${seq})`);
        } else {
          this.logger.log(`[submitted] order ${order.id} confirmed → active (orderbook registered, seq 추출 실패)`);
        }
      } else if (result === 'failed') {
        await this.updateOrderStatus(order.id, 'failed');
        this.logger.log(`[submitted] order ${order.id} tx failed → failed`);
      }
      // result === 'pending': tx가 아직 컨펌되지 않음 — 다음 폴링에서 재확인
    }
  }

  /**
   * active 주문 처리 — 온체인 오더북 대조 + 체결 여부 확인
   *
   * 1. active 주문을 token_id별로 그룹화
   * 2. 각 토큰의 Manifest 마켓을 한 번만 로드하여 온체인 오더북 스냅샷 구축
   * 3. 각 주문의 manifest_sequence_number로 온체인 매칭:
   *    - 온체인에 없음 + FillEvent 있음 → filled
   *    - 온체인에 없음 + FillEvent 없음 → cancelled (cancel/evict)
   *    - 온체인에 있음 + lastValidSlot 만료 → expired
   *    - 온체인에 있음 + 정상 → active 유지
   *    - seq 추출 불가(tx_signature 없음) → 5분 후 failed
   */
  private async checkActiveOrders(): Promise<{ filled: number; failed: number; expired: number; pending: number; cancelled: number }> {
    const { data: orders, error } = await this.client
      .from('orders')
      .select('id, tx_signature, quantity, created_at, token_id, user_id, manifest_sequence_number')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(this.BATCH_SIZE);

    if (error || !orders || orders.length === 0) {
      return { filled: 0, failed: 0, expired: 0, pending: 0, cancelled: 0 };
    }

    const typedOrders = orders as unknown as SubmittedOrder[];
    let filled = 0;
    let failed = 0;
    let expired = 0;
    let cancelled = 0;
    let pending = 0;

    // token_id별로 그룹화
    const ordersByToken = new Map<string, SubmittedOrder[]>();
    for (const order of typedOrders) {
      if (!order.token_id) continue;
      const tid = order.token_id as string;
      if (!ordersByToken.has(tid)) ordersByToken.set(tid, []);
      ordersByToken.get(tid)!.push(order);
    }

    // 각 토큰별로 마켓 로드 + 주문 검증
    for (const [tokenId, tokenOrders] of ordersByToken) {
      // 마켓 캐시 로드
      let marketCache: MarketCache | null = null;
      try {
        marketCache = await this.loadMarketCache(tokenId);
      } catch (err) {
        this.logger.warn(`[active] 마켓 로드 실패 token=${tokenId}: ${err instanceof Error ? err.message : String(err)}`);
      }

      for (const order of tokenOrders) {
        // tx_signature가 없는 주문 = 서명 미완료 → 5분 후 failed
        if (!order.tx_signature) {
          const ageMs = Date.now() - new Date(order.created_at).getTime();
          if (ageMs > this.PENDING_ORPHAN_TIMEOUT_MS) {
            await this.updateOrderStatus(order.id, 'failed');
            failed++;
            continue;
          }
          pending++;
          continue;
        }

        // manifest_sequence_number 추출 (없으면 placement tx에서 추출 후 DB 저장)
        let seqNum = order.manifest_sequence_number;
        if (seqNum == null) {
          const { seq } = await this.extractOrderSequenceNumber(order.tx_signature, order.id);
          if (seq != null) {
            seqNum = seq;
          } else {
            // PlaceOrderLog를 찾을 수 없음 — tx에 주문 로그가 없음
            // 이 주문은 사실상 체인에 등록되지 않은 것으로 간주
            this.logger.warn(`[active] order ${order.id} — PlaceOrderLog 없음, cancelled 처리`);
            await this.updateOrderStatus(order.id, 'cancelled');
            cancelled++;
            continue;
          }
        }

        // 마켓 캐시 없으면 FillEvent만 확인
        if (!marketCache) {
          const fillResult = await this.checkFillFromTxLogs(order.tx_signature, order.id);
          if (fillResult.filled) {
            const fillQty = Number.isFinite(fillResult.baseAtomsTokens) ? fillResult.baseAtomsTokens : order.quantity;
            await this.updateOrderStatus(order.id, 'filled', fillQty);
            filled++;
          } else {
            pending++;
          }
          continue;
        }

        // 온체인 오더북에서 sequenceNumber로 매칭
        const onChainOrder = marketCache.ordersBySeq.get(String(seqNum));

        if (onChainOrder) {
          // 온체인에 존재 → lastValidSlot 만료 확인
          if (onChainOrder.lastValidSlot > 0) {
            const currentSlot = await this.getCurrentSlot();
            if (currentSlot > 0 && onChainOrder.lastValidSlot < currentSlot) {
              await this.updateOrderStatus(order.id, 'expired');
              expired++;
              this.logger.log(`[active] order ${order.id} EXPIRED (lvs=${onChainOrder.lastValidSlot} < current=${currentSlot})`);
              continue;
            }
          }
          // 정상 active — 유지
          pending++;
        } else {
          // 온체인에서 사라짐 → FillEvent 확인
          const fillResult = await this.checkFillFromTxLogs(order.tx_signature, order.id);
          if (fillResult.filled) {
            const fillQty = Number.isFinite(fillResult.baseAtomsTokens) ? fillResult.baseAtomsTokens : order.quantity;
            await this.updateOrderStatus(order.id, 'filled', fillQty);
            filled++;
            this.logger.log(
              `[active] order ${order.id} FILLED (tx log, vanished from book) — qty=${fillQty}`,
            );
          } else {
            // FillEvent 없음 → cancel 또는 Manifest evict
            await this.updateOrderStatus(order.id, 'cancelled');
            cancelled++;
            this.logger.log(`[active] order ${order.id} CANCELLED (vanished from book, no FillEvent)`);
          }
        }
      }
    }

    // token_id가 없는 주문 처리
    const orphanOrders = typedOrders.filter(o => !o.token_id);
    for (const order of orphanOrders) {
      if (!order.tx_signature) {
        const ageMs = Date.now() - new Date(order.created_at).getTime();
        if (ageMs > this.PENDING_ORPHAN_TIMEOUT_MS) {
          await this.updateOrderStatus(order.id, 'failed');
          failed++;
        } else {
          pending++;
        }
      } else {
        pending++;
      }
    }

    const total = filled + cancelled + expired + failed;
    if (total > 0) {
      this.logger.log(`[active] check result: ${filled} filled, ${cancelled} cancelled, ${expired} expired, ${failed} failed, ${pending} pending`);
    }

    return { filled, failed, expired, pending, cancelled };
  }

  /**
   * 토큰의 Manifest 마켓을 로드하여 온체인 오더북 스냅샷 반환
   */
  private async loadMarketCache(tokenId: string): Promise<MarketCache | null> {
    // 토큰의 mint_address 조회
    const { data: token } = await this.client
      .from('tokens')
      .select('mint_address')
      .eq('id', tokenId)
      .single();
    if (!token?.mint_address) return null;

    const { Market } = await import('@cks-systems/manifest-sdk');
    const markets = await Market.findByMints(
      this.connection,
      new PublicKey(token.mint_address),
      new PublicKey(USDT_MINT),
    );
    if (!markets || markets.length === 0) return null;

    const m = markets[0];
    const openOrders = m.openOrders();

    const ordersBySeq = new Map<string, ChainOrderInfo>();
    for (const o of openOrders) {
      const trader = o.trader ? o.trader.toBase58() : '';
      ordersBySeq.set(o.sequenceNumber.toString(), {
        sequenceNumber: o.sequenceNumber.toString(),
        lastValidSlot: Number(o.lastValidSlot),
        trader,
      });
    }

    return { ordersBySeq };
  }

  /**
   * 현재 Solana 슬롯 반환 (캐시 없이 매번 호출 — 빠른 RPC 호출)
   */
  private async getCurrentSlot(): Promise<number> {
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }),
      });
      const data = await res.json() as { result?: number };
      return typeof data.result === 'number' ? data.result : 0;
    } catch {
      return 0;
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

      // "Program data: <base64>" 항목에서 fill 이벤트 찾기
      // FILL_DISCRIMINANT는 상수(3ae6f2034b7104a9)이므로 로드 실패 불가
      for (const log of logs) {
        if (!log.startsWith('Program data: ')) continue;

        const base64Data = log.split(' ')[2];
        if (!base64Data) continue;

        try {
          const buffer = Buffer.from(base64Data, 'base64');

          // 첫 8바이트가 FILL_DISCRIMINANT와 일치하는지 확인
          if (!buffer.subarray(0, 8).equals(FILL_DISCRIMINANT)) continue;

          // fill 이벤트 발견 — FillLog 역직렬화
          const { FillLog } = await import('@cks-systems/manifest-sdk/dist/cjs/manifest/accounts/FillLog');
          const fillLog = FillLog.deserialize(buffer.subarray(8))[0];

          // baseAtoms / quoteAtoms는 원시 숫자가 아니라 { inner: bignum } 래퍼
          // (BaseAtoms/QuoteAtoms 클래스)로 역직렬화된다. 이 unwrap 없이 바로
          // Number(obj.toString())을 하면 "[object Object]" → NaN이 되고,
          // 그 NaN이 filled_qty로 DB에 들어가려다 NOT NULL 제약을 위반해
          // 상태 업데이트 자체가 계속 실패 — 주문이 영원히 미체결로 남는 버그였음.
          const toNumber = (v: unknown): number => {
            if (typeof v === 'number') return v;
            if (typeof v === 'bigint') return Number(v);
            const raw =
              v && typeof v === 'object' && 'inner' in v
                ? (v as { inner: unknown }).inner
                : v;
            if (typeof raw === 'number') return raw;
            if (typeof raw === 'bigint') return Number(raw);
            return Number((raw as { toString?: () => string })?.toString?.() ?? 0);
          };
          const baseAtoms = toNumber(fillLog.baseAtoms);
          const quoteAtoms = toNumber(fillLog.quoteAtoms);
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

    // filledQty가 NaN이면(위 계산 단계에서 걸러지지만 이중 안전장치로) 컬럼이
    // NOT NULL이라 update 자체가 실패해 상태가 영원히 안 바뀌는 사고로 이어짐 —
    // 그런 경우엔 필드를 아예 빼서 상태만이라도 정상 반영되게 한다.
    const filledQtyValid = typeof filledQty === 'number' ? Number.isFinite(filledQty) : filledQty !== undefined;
    if (status === 'filled' && filledQtyValid) {
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
