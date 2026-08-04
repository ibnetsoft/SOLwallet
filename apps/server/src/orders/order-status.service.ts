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

/** Manifest SDK Market 타입 — 동적 import로만 사용하므로 필요한 형태만 구조적으로 정의 */

@Injectable()
export class OrderStatusService {
  private readonly logger = new Logger(OrderStatusService.name);
  private readonly rpcUrl: string;

  /** submitted/active 주문을 타임아웃 처리할 기준 (1시간) */
  private readonly ORDER_TIMEOUT_MS = 60 * 60 * 1000;
  /** pending인데 tx_signature가 끝내 안 채워진 고아 주문 정리 기준 (5분) —
   *  정상적인 서명·제출은 수십 초 내로 끝나므로 충분히 넉넉한 값 */
  private readonly PENDING_ORPHAN_TIMEOUT_MS = 5 * 60 * 1000;
  /** 단일 폴링에서 처리할 최대 주문 수 */
  private readonly BATCH_SIZE = 100;
  /** fill 이벤트 식별용 discriminant (Manifest SDK와 동일) */
  private fillDiscriminant: Buffer | null = null;
  /** 주문 생성(PlaceOrder) 이벤트 식별용 discriminant */
  private placeOrderDiscriminant: Buffer | null = null;
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
   * placeOrderDiscriminant lazy 로드 — fillDiscriminant와 동일한 방식(keccak256)으로
   * 프로그램ID + 계정명("manifest::logs::PlaceOrderLog")으로부터 직접 계산.
   */
  private async getPlaceOrderDiscriminant(): Promise<Buffer> {
    if (this.placeOrderDiscriminant) return this.placeOrderDiscriminant;
    try {
      const { genAccDiscriminator } = await import('@cks-systems/manifest-sdk/dist/cjs/utils/discriminator');
      this.placeOrderDiscriminant = genAccDiscriminator('manifest::logs::PlaceOrderLog');
      this.logger.log(`[fillCheck] placeOrderDiscriminant loaded: ${this.placeOrderDiscriminant.toString('hex')}`);
      return this.placeOrderDiscriminant;
    } catch (err) {
      this.logger.error(`[fillCheck] Failed to load placeOrderDiscriminant: ${err instanceof Error ? err.message : String(err)}`);
      this.placeOrderDiscriminant = Buffer.alloc(0);
      return this.placeOrderDiscriminant;
    }
  }

  /**
   * 주문 제출(placement) tx 로그에서 Manifest가 부여한 orderSequenceNumber를 추출.
   *
   * ⚠️ 이게 없으면(지금까지 쭉 그랬음) checkActiveOrders의 2단계 검사
   * (isOrderStillOpen — 다른 트레이더가 나중에 체결시킨 경우 감지)가
   * `sequenceNumber != null` 가드에 막혀 항상 건너뛰어진다. 그 결과 self-cross가
   * 아닌 일반적인 체결은 영원히 감지되지 않고 주문이 계속 "미체결"로 남으며,
   * 정작 Manifest에는 이미 사라진 주문이라 취소 시도 시 "no open orders" 404로
   * 실패하는 형태로 드러남 — 실제로 사용자가 겪은 증상과 일치.
   */
  private async extractOrderSequenceNumber(signature: string): Promise<number | null> {
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
      if (!logs) return null;

      const discriminant = await this.getPlaceOrderDiscriminant();
      if (discriminant.length === 0) return null;

      for (const log of logs) {
        if (!log.startsWith('Program data: ')) continue;
        const base64Data = log.split(' ')[2];
        if (!base64Data) continue;

        try {
          const buffer = Buffer.from(base64Data, 'base64');
          if (!buffer.subarray(0, 8).equals(discriminant)) continue;

          const { PlaceOrderLog } = await import('@cks-systems/manifest-sdk/dist/cjs/manifest/accounts/PlaceOrderLog');
          const placeLog = PlaceOrderLog.deserialize(buffer.subarray(8))[0];
          const seq = Number(placeLog.orderSequenceNumber.toString());
          return Number.isFinite(seq) ? seq : null;
        } catch {
          continue;
        }
      }
      return null;
    } catch (err) {
      this.logger.warn(`[fillCheck] Failed to extract sequence number for ${signature}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
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
   * 일회성 과거 주문 복구 — 이미 expired/failed로 잘못 분류된 주문 중
   * tx 로그에 실제 FillEvent가 있는 것을 찾아 filled로 되돌린다.
   *
   * 어드민에서 수동 실행 (POST /api/admin/orders/reconcile).
   * ⚠️ "오더북에서 사라짐 = 체결" 휴리스틱은 사용하지 않는다 — 취소/만료와
   * 구분이 안 되어 가짜 체결을 양산한다. 오직 FillEvent 로그만이 체결의 증거.
   * 따라서 tx_signature가 있는 주문만 대상이 된다.
   */
  async reconcilePastOrders(): Promise<{ checked: number; recovered: number }> {
    // expired/failed 주문 중 tx_signature가 있는 것만 (FillEvent 확인 가능)
    const { data: orders, error } = await this.client
      .from('orders')
      .select('id, status, tx_signature, quantity')
      .in('status', ['expired', 'failed'])
      .not('tx_signature', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error || !orders || orders.length === 0) {
      return { checked: 0, recovered: 0 };
    }

    let recovered = 0;

    for (const order of orders) {
      const fillResult = await this.checkFillFromTxLogs(order.tx_signature as string, order.id as string);

      if (fillResult.filled) {
        const fillQty = Number.isFinite(fillResult.baseAtomsTokens)
          ? fillResult.baseAtomsTokens
          : (order.quantity as number);
        await this.updateOrderStatus(order.id as string, 'filled', fillQty);
        recovered++;
        this.logger.log(`[reconcile] order ${order.id} recovered: ${order.status} → filled (FillEvent confirmed)`);
      }
    }

    this.logger.log(`[reconcile] checked ${orders.length} orders, recovered ${recovered} to filled`);
    return { checked: orders.length, recovered };
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
      const ageMs = Date.now() - new Date(order.created_at).getTime();
      if (ageMs > this.ORDER_TIMEOUT_MS) {
        await this.updateOrderStatus(order.id, 'expired');
        continue;
      }

      const result = await this.checkTransactionStatus(order.tx_signature);

      if (result === 'success') {
        // tx 성공 = orderbook에 등록 → active
        await this.updateOrderStatus(order.id, 'active');

        // 이후 2단계 체결 감지(온체인 오더북 대조)에 필요한 orderSequenceNumber를
        // 지금 확보해둔다 — placement tx 로그에서만 얻을 수 있고, 나중에 다시
        // 시도하면 fresh-tx로 재제출돼 시퀀스 번호도 바뀌므로 반드시 이 시점에 잡아야 함.
        const seq = await this.extractOrderSequenceNumber(order.tx_signature);
        if (seq != null) {
          const { error: seqError } = await this.client
            .from('orders')
            .update({ manifest_sequence_number: seq })
            .eq('id', order.id);
          if (seqError) {
            this.logger.warn(`[submitted] Failed to save sequence number for ${order.id}: ${seqError.message}`);
          } else {
            this.logger.log(`[submitted] order ${order.id} confirmed → active (seq=${seq})`);
          }
        } else {
          this.logger.log(`[submitted] order ${order.id} confirmed → active (orderbook registered, seq 추출 실패)`);
        }
      } else if (result === 'failed') {
        await this.updateOrderStatus(order.id, 'failed');
        this.logger.log(`[submitted] order ${order.id} tx failed → failed`);
      }
    }
  }

  /**
   * active 주문 처리 — 체결 여부 확인 (placement tx 로그에서 FillEvent 파싱)
   *
   * ⚠️ "오더북에서 사라짐 = 체결" 휴리스틱은 사용하지 않는다 — 취소/만료/부분체결도
   * 오더북에서 사라지므로 체결과 구분할 수 없다. 오직 실제 FillEvent 로그만이
   * 체결의 증거다. 타임아웃 전까지 FillEvent가 없으면 미체결(오픈)로 둔다.
   */
  private async checkActiveOrders(): Promise<{ filled: number; failed: number; expired: number; pending: number }> {
    const { data: orders, error } = await this.client
      .from('orders')
      .select('id, tx_signature, quantity, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: true }) // 오래된 주문 우선 처리
      .limit(this.BATCH_SIZE);

    if (error || !orders || orders.length === 0) {
      return { filled: 0, failed: 0, expired: 0, pending: 0 };
    }

    const typedOrders = orders as unknown as SubmittedOrder[];
    let filled = 0;
    let expired = 0;
    let pending = 0;

    for (const order of typedOrders) {
      const ageMs = Date.now() - new Date(order.created_at).getTime();
      const isOverTimeout = ageMs > this.ORDER_TIMEOUT_MS;

      // 체결 감지 — 오직 placement tx 로그에서 실제 FillEvent가 확인된 경우만 filled.
      // ⚠️ "오더북에서 사라짐 = 체결" 휴리스틱은 사용하지 않는다 — 취소/만료/부분체결도
      //    오더북에서 사라지므로, 이것만으로는 체결을 확정할 수 없다.
      //    tx_signature가 있으면 placement tx의 FillEvent를, 없으면 체결 증거 없음.
      if (order.tx_signature) {
        const fillResult = await this.checkFillFromTxLogs(order.tx_signature, order.id);

        if (fillResult.filled) {
          const fillQty = Number.isFinite(fillResult.baseAtomsTokens) ? fillResult.baseAtomsTokens : order.quantity;
          await this.updateOrderStatus(order.id, 'filled', fillQty);
          filled++;
          this.logger.log(
            `[active] order ${order.id} FILLED (tx log) — qty=${fillQty} quote=${fillResult.quoteAtomsTokens ?? 'N/A'}`,
          );
          continue;
        }
      }

      // FillEvent가 없으면 미체결(오픈) 상태 유지 — 타임아웃 시에만 정리
      if (isOverTimeout) {
        // tx_signature가 없는 주문은 체인에 올라간 적이 없으므로 failed, 있으면 expired
        await this.updateOrderStatus(order.id, order.tx_signature ? 'expired' : 'failed');
        if (order.tx_signature) expired++;
        else { /* failed는 집계에서 제외하되 카운트는 추적 */ }
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
