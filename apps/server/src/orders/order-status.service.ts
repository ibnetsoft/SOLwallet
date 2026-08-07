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
  manifest_market_address?: string | null;
  user_id?: string;
  /** 자식 주문 생성용 추가 필드 */
  price?: string | number;
  fee_rate?: string | number;
  order_type?: string;
  fee?: string | number;
}

/** 온체인 오더북에서 주문 매칭에 사용하는 정보 */
interface ChainOrderInfo {
  sequenceNumber: string;
  lastValidSlot: number;
  trader: string;
}

/** crank fill tx에서 수집한 체결 정보 (sequence number로 정확 매칭) */
interface CrankFillInfo {
  /** 체결된 maker order sequence number (FillLog에서 추출) */
  seqNumbers: number[];
  /** 체결된 base token 수량 (tokens) */
  baseAtomsTokens: number;
  /** 체결된 quote token 수량 (USDT tokens) */
  quoteAtomsTokens: number;
  /** 실제 체결 가격 (quoteAtomsTokens / baseAtomsTokens) */
  price: number;
  /** 이 체결이 포함된 crank tx 시그니처 */
  txSignature: string;
}

/** 가격대별 체결 정보 — 하나의 crank fill tx 안에서 발생한 체결 */
interface PerPriceFill {
  price: number;
  baseAtomsTokens: number;
  quoteAtomsTokens: number;
  txSignature: string;
}

/** 토큰별로 그룹화된 온체인 마켓 데이터 */
interface MarketCache {
  /** sequenceNumber → ChainOrderInfo */
  ordersBySeq: Map<string, ChainOrderInfo>;
  /** manifest market address (crank fill 검색용) */
  marketAddress: string;
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

        if (fillResult.fills.length > 0) {
          const totalFilled = fillResult.fills.reduce((s, f) => s + f.baseAtomsTokens, 0);
          await this.updateOrderStatus(order.id as string, 'filled', totalFilled);
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
            if (fillResult.fills.length > 0) {
              const totalFilled = fillResult.fills.reduce((s, f) => s + f.baseAtomsTokens, 0);
              await this.updateOrderStatus(order.id, 'filled', totalFilled);
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
            // 정상 active → 변경 없음
            // (lastValidSlot 만료 체크 제거 — 사용자가 취소하지 않은 주문은 자동 만료시키지 않음)
          } else {
            // 온체인에서 사라짐 → FillEvent 확인
            const fillResult = await this.checkFillFromTxLogs(order.tx_signature, order.id);
            if (fillResult.fills.length > 0) {
              const totalFilled = fillResult.fills.reduce((s, f) => s + f.baseAtomsTokens, 0);
              await this.updateOrderStatus(order.id, 'filled', totalFilled);
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
      .select('id, tx_signature, quantity, price, side, fee_rate, order_type, fee, created_at, token_id, user_id, wallet_id, manifest_sequence_number, manifest_market_address')
      .eq('status', 'active')
      .is('parent_order_id', null)
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

      // crank fill 캐시 — 이 토큰 그룹에서 한 번만 수집
      let crankFills: CrankFillInfo[] = [];
      let crankFillCollected = false;

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

        // 체결 분할 처리 헬퍼: PerPriceFill[] → 자식 주문 생성 + 원본 차감
        const handleFills = async (fills: PerPriceFill[], source: string) => {
          if (fills.length === 0) return;
          const totalFilled = fills.reduce((s, f) => s + f.baseAtomsTokens, 0);
          this.logger.log(
            `[active] order ${order.id} ${fills.length} fill(s) from ${source}: total=${totalFilled} qty=${order.quantity}`,
          );
          // 자식 체결 주문들 생성 (멱등) — 실제로 삽입된 수량만큼만 차감
          const insertedQty = await this.createChildFillOrders(order, fills);
          if (insertedQty <= 0) {
            // 자식 주문이 하나도 생성되지 않았다면(오류 또는 전부 중복) 원본 차감 X
            this.logger.warn(
              `[active] order ${order.id}: 자식 주문 생성 없음 — 원본 quantity 유지`,
            );
            pending++;
            return;
          }
          // 원본 주문 quantity 차감 (삽입된 수량만큼)
          const newStatus = await this.reduceParentOrderQuantity(order.id, insertedQty);
          if (newStatus === 'filled') {
            filled++;
          } else {
            // 남은 잔량이 active로 유지 — pending에 포함하지 않음 (active 유지 상태)
            this.logger.log(`[active] order ${order.id}: remaining active after ${fills.length} child fills`);
          }
        };

        // 마켓 캐시 없으면 FillEvent만 확인
        if (!marketCache) {
          const fillResult = await this.checkFillFromTxLogs(order.tx_signature, order.id);
          if (fillResult.checked && fillResult.fills.length > 0) {
            await handleFills(fillResult.fills, 'placement tx');
          } else {
            pending++;
          }
          continue;
        }

        // 온체인 오더북에서 sequenceNumber로 매칭
        const onChainOrder = marketCache.ordersBySeq.get(String(seqNum));

        if (onChainOrder) {
          // 온체인에 존재 → crank fill 검사
          if (!crankFillCollected && marketCache) {
            crankFillCollected = true;
            crankFills = await this.collectCrankFills(marketCache.marketAddress);
          }
          const matchedFills = await this.checkCrankFillsPerPrice(order, crankFills);
          if (matchedFills.length > 0) {
            await handleFills(matchedFills, 'crank (on book)');
          } else {
            pending++;
          }
        } else {
          // 온체인에서 사라짐 → placement tx FillEvent 확인
          const fillResult = await this.checkFillFromTxLogs(order.tx_signature, order.id);
          if (fillResult.checked && fillResult.fills.length > 0) {
            await handleFills(fillResult.fills, 'placement tx (vanished)');
          } else {
            // placement tx에 FillEvent 없음 → crank fill 확인
            if (!crankFillCollected && marketCache) {
              crankFillCollected = true;
              crankFills = await this.collectCrankFills(marketCache.marketAddress);
            }
            const matchedFills = await this.checkCrankFillsPerPrice(order, crankFills);
            if (matchedFills.length > 0) {
              await handleFills(matchedFills, 'crank tx (vanished)');
            } else {
              // FillEvent 없음 → cancel 또는 Manifest evict
              await this.updateOrderStatus(order.id, 'cancelled');
              cancelled++;
              this.logger.log(`[active] order ${order.id} CANCELLED (vanished from book, no FillEvent)`);
            }
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

    return { ordersBySeq, marketAddress: m.address.toString() };
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
   * 가격대별 체결 분할을 위해 PerPriceFill[]을 반환.
   */
  private async checkFillFromTxLogs(
    signature: string,
    orderId: string,
  ): Promise<{ fills: PerPriceFill[]; checked: boolean }> {
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
        return { fills: [], checked: false };
      }

      const logs = data.result.meta?.logMessages;
      if (!logs) {
        return { fills: [], checked: false };
      }

      // "Program data: <base64>" 항목에서 fill 이벤트 찾기
      // FILL_DISCRIMINANT는 상수(3ae6f2034b7104a9)이므로 로드 실패 불가
      const foundFills: PerPriceFill[] = [];
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
          const price = baseAtomsTokens > 0 ? quoteAtomsTokens / baseAtomsTokens : 0;

          if (baseAtomsTokens > 0) {
            foundFills.push({ price, baseAtomsTokens, quoteAtomsTokens, txSignature: signature });
          }
        } catch {
          // 역직렬화 실패 — 다음 로그 확인
          continue;
        }
      }

      return { fills: foundFills, checked: true };
    } catch (err) {
      this.logger.error(`[fillCheck] Failed for ${orderId}: ${err instanceof Error ? err.message : String(err)}`);
      return { fills: [], checked: false };
    }
  }

  /**
   * 수집된 crank fill 캐시에서 이 주문의 sequence number가 매칭되는지 확인.
   *
   * FillLog에는 maker/taker sequence number가 명시적으로 포함되므로,
   * 수량 기반 추정(50%) 대신 sequence number로 정확 매칭한다.
   * 가격대별 체결 분할을 위해 PerPriceFill[]을 반환.
   *
   * @returns 매칭된 체결 목록 (빈 배열이면 체결되지 않음)
   */
  private async checkCrankFillsPerPrice(
    order: SubmittedOrder,
    crankFillCache: CrankFillInfo[],
  ): Promise<PerPriceFill[]> {
    const seqNum = Number(order.manifest_sequence_number);
    if (!Number.isFinite(seqNum) || seqNum <= 0) return [];

    const matched: PerPriceFill[] = [];
    for (const fill of crankFillCache) {
      if (fill.seqNumbers.includes(seqNum)) {
        matched.push({
          price: fill.price,
          baseAtomsTokens: fill.baseAtomsTokens,
          quoteAtomsTokens: fill.quoteAtomsTokens,
          txSignature: fill.txSignature,
        });
      }
    }

    if (matched.length > 0) {
      const totalQty = matched.reduce((s, f) => s + f.baseAtomsTokens, 0);
      this.logger.log(
        `[crankFill] order ${order.id} seq=${seqNum}: matched ${matched.length} fills, total qty=${totalQty}`,
      );
    }

    return matched;
  }

  /**
   * Manifest market address의 최근 tx에서 crank fill 이벤트 수집.
   * market별로 폴링 사이클당 한 번만 호출.
   *
   * FillLog는 232바이트 고정 구조 (8바이트 discriminant + 224바이트 페이로드):
   *   offset 176 (u64): baseAtoms (raw atoms, /1e9 = token 수량)
   *   offset 184 (u64): quoteAtoms (USDT 원시값, /1e6 = USDT)
   *   offset 192 (u64): maker sequence number
   *   offset 200 (u64): taker sequence number
   * SDK의 FillLog.deserialize가 beet offset 오류를 일으키므로 수동 파싱.
   */
  private async collectCrankFills(
    marketAddress: string,
    placementSlot?: number,
  ): Promise<CrankFillInfo[]> {
    const fills: CrankFillInfo[] = [];

    try {
      const { PublicKey } = await import('@solana/web3.js');
      const marketPk = new PublicKey(marketAddress);

      const sigs = await this.connection.getSignaturesForAddress(marketPk, {
        limit: 25,
      });

      for (const sigInfo of sigs) {
        // placement보다 확실히 이전 슬롯만 스킵.
        // 같은 슬롯도 포함하는 이유: Manifest crank은 placement tx와 같은 슬롯에서
        // 즉시 매칭을 수행할 수 있음 (slot 437672587에서 확인됨).
        if (placementSlot !== undefined && sigInfo.slot < placementSlot) continue;

        try {
          const tx = await this.connection.getTransaction(sigInfo.signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
          });
          if (!tx || !tx.meta) continue;

          const logs = tx.meta.logMessages || [];
          for (const log of logs) {
            if (!log.startsWith('Program data: ')) continue;

            const base64Data = log.split(' ')[2];
            if (!base64Data) continue;

            try {
              const buffer = Buffer.from(base64Data, 'base64');
              if (!buffer.subarray(0, 8).equals(FILL_DISCRIMINANT)) continue;
              // FillLog는 232바이트 고정 길이
              if (buffer.length !== 232) continue;

              const payload = buffer.subarray(8);
              const baseAtoms = Number(payload.readBigUInt64LE(176));
              const quoteAtoms = Number(payload.readBigUInt64LE(184));
              const makerSeq = Number(payload.readBigUInt64LE(192));
              const takerSeq = Number(payload.readBigUInt64LE(200));
              const baseAtomsTokens = baseAtoms / 1e9;
              const quoteAtomsTokens = quoteAtoms / 1e6;
              const price = baseAtomsTokens > 0 ? quoteAtomsTokens / baseAtomsTokens : 0;

              if (baseAtomsTokens > 0 && (makerSeq > 0 || takerSeq > 0)) {
                fills.push({
                  seqNumbers: [makerSeq, takerSeq].filter((s) => s > 0),
                  baseAtomsTokens,
                  quoteAtomsTokens,
                  price,
                  txSignature: sigInfo.signature,
                });
              }
            } catch {
              continue;
            }
          }
        } catch {
          // tx 조회 실패 — 다음 시그니처로 계속
          continue;
        }
      }
    } catch (err) {
      this.logger.warn(`[crankFill] collect failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return fills;
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

  /**
   * 가격대별 체결 → 자식 "filled" 주문 생성
   *
   * 각 PerPriceFill에 대해 orders 테이블에 새 row를 INSERT.
   * 멱등성: parent_order_id + price + quantity + tx_signature 조합으로 중복 방지.
   */
  private async createChildFillOrders(
    parentOrder: SubmittedOrder,
    fills: PerPriceFill[],
  ): Promise<number> {
    let insertedQty = 0;
    for (const fill of fills) {
      // 멱등성 확인: 이미 같은 자식 주문이 있으면 스킵
      const { data: existing, error: checkErr } = await this.client
        .from('orders')
        .select('id, quantity')
        .eq('parent_order_id', parentOrder.id)
        .eq('price', fill.price)
        .eq('quantity', fill.baseAtomsTokens)
        .eq('tx_signature', fill.txSignature)
        .limit(1);

      if (checkErr || !existing) continue;
      if (existing.length > 0) {
        // 중복이어도 이미 삽입된 수량으로 계산 — 다음 폴링에서 재처리 방지
        insertedQty += Number(existing[0].quantity ?? 0);
        this.logger.log(
          `[childFill] skip duplicate: parent=${parentOrder.id} price=${fill.price} qty=${fill.baseAtomsTokens} tx=${fill.txSignature.slice(0, 8)}`,
        );
        continue;
      }

      // 수수료 계산: 실제 체결가 × 수량 × fee_rate
      const feeRate = Number(parentOrder.fee_rate ?? 0.01);
      const fee = fill.baseAtomsTokens * fill.price * feeRate;

      const { error: insertErr } = await this.client
        .from('orders')
        .insert({
          parent_order_id: parentOrder.id,
          user_id: parentOrder.user_id,
          wallet_id: parentOrder.wallet_id,
          token_id: parentOrder.token_id,
          side: parentOrder.side,
          order_type: parentOrder.order_type ?? 'limit',
          price: fill.price,
          quantity: fill.baseAtomsTokens,
          filled_qty: fill.baseAtomsTokens,
          fee: Math.round(fee * 1e6) / 1e6,
          fee_rate: feeRate,
          status: 'filled',
          tx_signature: fill.txSignature,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertErr) {
        this.logger.error(
          `[childFill] failed to create: parent=${parentOrder.id} price=${fill.price} qty=${fill.baseAtomsTokens}: ${insertErr.message}`,
        );
      } else {
        insertedQty += fill.baseAtomsTokens;
        this.logger.log(
          `[childFill] created: parent=${parentOrder.id} price=${fill.price} qty=${fill.baseAtomsTokens} usdt=${fill.quoteAtomsTokens} tx=${fill.txSignature.slice(0, 8)}`,
        );
      }
    }
    return insertedQty;
  }

  /**
   * 원본 주문의 quantity를 체결된 수량만큼 차감.
   *
   * - quantity -= totalFilledQty
   * - filled_qty는 0으로 유지 (부분체결 개념 제거)
   * - 차감 후 quantity <= 0.0001 → status = 'filled'
   * - 아니면 status = 'active' 유지
   *
   * @returns 'filled' | 'active'
   */
  private async reduceParentOrderQuantity(
    orderId: string,
    totalFilledQty: number,
  ): Promise<'filled' | 'active'> {
    // 현재 quantity 확인
    const { data: existing } = await this.client
      .from('orders')
      .select('quantity')
      .eq('id', orderId)
      .single();

    const currentQty = Number(existing?.quantity ?? 0);
    const newQty = Math.max(0, currentQty - totalFilledQty);

    // 잔량이 극소량(수치오차 범위)이면 전량 체결 처리
    const isFullyFilled = newQty <= 0.0001;

    const { error } = await this.client
      .from('orders')
      .update({
        quantity: isFullyFilled ? 0 : Math.round(newQty * 1e6) / 1e6,
        filled_qty: 0,
        status: isFullyFilled ? 'filled' : 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (error) {
      this.logger.error(`[reduceQty] failed for ${orderId}: ${error.message}`);
    } else {
      this.logger.log(
        `[reduceQty] order ${orderId}: quantity ${currentQty} → ${isFullyFilled ? 0 : newQty}, status → ${isFullyFilled ? 'filled' : 'active'} (filled=${totalFilledQty})`,
      );
    }

    return isFullyFilled ? 'filled' : 'active';
  }
}
