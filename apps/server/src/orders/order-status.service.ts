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
interface RestingOrderLike {
  price: { toString?: () => string } | number | bigint;
  numBaseAtoms: { toString?: () => string } | number | bigint;
  sequenceNumber: { toString?: () => string } | number | bigint;
  traderIndex: number;
  lastValidSlot: number;
  isBid: boolean;
}

interface ClaimedSeatLike {
  trader: { toBase58: () => string };
  baseWithdrawableBalance: { toString?: () => string } | number | bigint;
  quoteWithdrawableBalance: { toString?: () => string } | number | bigint;
}

interface MarketLike {
  openOrders(): RestingOrderLike[];
  claimedSeats(): ClaimedSeatLike[];
}

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
   * Manifest SDK의 bignum 래퍼({ inner: bigint } 또는 bigint/number)를 number로 변환.
   * number 범위를 넘는 매우 큰 값은 정밀도가 떨어질 수 있지만, 시퀀스 번호/가격 등은
   * 안전 범위 내이므로 Number()를 사용한다.
   */
  private toBigNumber(v: { toString?: () => string } | number | bigint | undefined): number {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint') return Number(v);
    // { inner: bigint } 래퍼인 경우 toString이 "123n"이 아니라 "123"을 반환하므로 안전
    const raw = v && typeof v === 'object' && 'inner' in v ? (v as { inner: unknown }).inner : v;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'bigint') return Number(raw);
    return Number((raw as { toString?: () => string })?.toString?.() ?? 0);
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
   * 온체인에서 실제로 체결된 것을 찾아 filled로 되돌린다.
   *
   * 어드민에서 수동 실행 (POST /api/admin/orders/reconcile).
   * active 주문에 비해 대상이 적고(이미 종료된 상태), 온체인에 남아있지 않으므로
   * "사라짐 = 체결" 휴리스틱으로 판단한다.
   */
  async reconcilePastOrders(): Promise<{ checked: number; recovered: number }> {
    // expired/failed 주문 중 wallet/token 정보가 있는 것들을 대상으로
    const { data: orders, error } = await this.client
      .from('orders')
      .select('id, status, quantity, side, price, wallet_id, token_id')
      .in('status', ['expired', 'failed'])
      .not('wallet_id', 'is', null)
      .not('token_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error || !orders || orders.length === 0) {
      return { checked: 0, recovered: 0 };
    }

    // 배치 조회용 맵
    const walletIds = Array.from(new Set(orders.map((o) => o.wallet_id).filter((v): v is string => !!v)));
    const tokenIds = Array.from(new Set(orders.map((o) => o.token_id).filter((v): v is string => !!v)));
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

    const marketCache = new Map<string, MarketLike | null>();
    let recovered = 0;

    for (const order of orders) {
      const traderPubkey = order.wallet_id ? walletMap[order.wallet_id] : undefined;
      const baseMint = order.token_id ? tokenMap[order.token_id] : undefined;

      if (!traderPubkey || !baseMint) continue;

      // 온체인 오더북에 이 주문이 남아있지 않으면 체결된 것으로 간주
      const stillOpen = await this.isOrderStillOpen(
        marketCache,
        baseMint,
        traderPubkey,
        undefined,
        (order as { price?: number }).price,
        (order as { side?: string }).side,
      );

      if (stillOpen === false) {
        await this.updateOrderStatus(order.id as string, 'filled', (order as { quantity?: number }).quantity);
        recovered++;
        this.logger.log(`[reconcile] order ${order.id} recovered: ${order.status} → filled`);
      }
    }

    this.logger.log(`[reconcile] checked ${orders.length} orders, recovered ${recovered} to filled`);
    return { checked: orders.length, recovered };
  }

  /**
   * 서명·제출이 끝내 안 된 고아 주문 정리 — status='failed'로 전환.
   *
   * 단, 단순히 failed로 바꾸기 전에 온체인에 실제로 주문이 접수되었을 수 있으므로
   * (클라이언트 서명 실패 전에 Manifest API가 이미 처리했을 가능성), 먼저 온체인
   * 오더북에서 해당 trader의 주문이 남아있는지 확인한다. 사라졌다면 체결된 것.
   *
   * createOrder는 DB에 status='pending'으로 주문을 만들고, Manifest가 unsigned tx
   * 생성 요청을 받아주면 status='active'로 바꾼다. 클라이언트 서명 실패·네트워크
   * 끊김·앱 종료로 submitOrder가 안 불리면 tx_signature가 null인 채 active로 남는다.
   */
  private async checkOrphanedPendingOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - this.PENDING_ORPHAN_TIMEOUT_MS).toISOString();
    const { data: orphans, error } = await this.client
      .from('orders')
      .select('id, created_at, wallet_id, token_id, side, price')
      .in('status', ['pending', 'active'])
      .is('tx_signature', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(this.BATCH_SIZE);

    if (error || !orphans || orphans.length === 0) return;

    // 온체인 오더북 대조용 맵 구축
    const walletIds = Array.from(new Set(orphans.map((o) => o.wallet_id).filter((v): v is string => !!v)));
    const tokenIds = Array.from(new Set(orphans.map((o) => o.token_id).filter((v): v is string => !!v)));
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

    const marketCache = new Map<string, MarketLike | null>();
    let filled = 0;
    let failed = 0;

    for (const order of orphans) {
      // 온체인에 실제로 주문이 남아있는지 확인
      const traderPubkey = order.wallet_id ? walletMap[order.wallet_id] : undefined;
      const baseMint = order.token_id ? tokenMap[order.token_id] : undefined;

      if (traderPubkey && baseMint) {
        const stillOpen = await this.isOrderStillOpen(
          marketCache,
          baseMint,
          traderPubkey,
          undefined,
          (order as { price?: number }).price,
          (order as { side?: string }).side,
        );

        if (stillOpen === false) {
          // 온체인에 없음 → 체결 또는 취소된 것. tx_signature가 없으므로 정확한
          // 체결 수량을 알 수 없어, 주문 수량 전체를 체결된 것으로 기록한다.
          // (취소 vs 체결 구분이 불가하므로 사용자 보호 차원에서 체결로 처리)
          const { data: fullOrder } = await this.client
            .from('orders')
            .select('quantity')
            .eq('id', order.id)
            .maybeSingle();
          await this.updateOrderStatus(order.id, 'filled', (fullOrder as { quantity?: number })?.quantity);
          filled++;
          continue;
        }
      }

      await this.updateOrderStatus(order.id, 'failed');
      failed++;
    }

    const total = orphans.length;
    if (filled > 0) {
      this.logger.log(`[pending] ${total}개 고아 주문 중 ${filled}개 체결 감지 → filled, ${failed}개 → failed`);
    } else if (total > 0) {
      this.logger.warn(`[pending] ${total}개 고아 주문(서명/제출 미완료) → failed 처리`);
    }
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
   * active 주문 처리 — 체결 여부 2단계 확인 (placement tx 로그 → 온체인 오더북 대조)
   *
   * ⚠️ tx_signature가 없는 주문도 포함한다 — createOrder가 Manifest 접수 즉시
   * active로 바꾸기 때문에, 클라이언트 서명 실패로 tx_signature가 안 채워진 주문이
   * active 상태로 영구 정체되는 일이 빈번하다. 이 주문들도 온체인에 실제로 올라갔을
   * 수 있으므로(Manifest API가 먼저 처리했을 수 있음) 모두 폴링 대상에 넣는다.
   */
  private async checkActiveOrders(): Promise<{ filled: number; failed: number; expired: number; pending: number }> {
    const { data: orders, error } = await this.client
      .from('orders')
      .select('id, tx_signature, quantity, side, price, created_at, wallet_id, token_id, manifest_sequence_number')
      .eq('status', 'active')
      .order('created_at', { ascending: true }) // 오래된 주문 우선 처리
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
      // tx_signature가 있는 경우에만 1단계 수행 (없으면 2단계로 바로)
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

      // 2단계: 온체인 오더북에 이 주문이 여전히 남아있는지 대조
      // sequenceNumber가 있든 없든 price/side로 매칭 가능 — 둘 중 하나로 판단
      const traderPubkey = order.wallet_id ? walletMap[order.wallet_id] : undefined;
      const baseMint = order.token_id ? tokenMap[order.token_id] : undefined;
      const sequenceNumber = order.manifest_sequence_number;
      const orderPrice = (order as { price?: number }).price;
      const orderSide = order.side;
      let stillOpen: boolean | null = null;

      if (traderPubkey && baseMint) {
        stillOpen = await this.isOrderStillOpen(
          marketCache,
          baseMint,
          traderPubkey,
          sequenceNumber != null ? Number(sequenceNumber) : undefined,
          orderPrice,
          orderSide,
        );
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
   * 특정 주문이 온체인 오더북에 여전히 resting order로 남아있는지 확인.
   * 마켓 조회 결과는 인자로 받은 캐시에 저장해 동일 폴링 사이클 내 중복 RPC 호출을 피한다.
   *
   * RestingOrder에는 traderIndex(숫자)만 있고 주소가 없으므로, claimedSeats()로
   * traderIndex → trader PublicKey 매핑을 먼저 구축해야 한다.
   *
   * 매칭 전략 (둘 중 하나로 판단):
   *  1. sequenceNumber가 있으면: traderIndex의 주소 + sequenceNumber 정확 매칭
   *  2. sequenceNumber가 없으면: traderIndex의 주소 + price + isBid(side) 매칭
   *
   * @returns true(아직 남아있음) / false(사라짐 — 체결로 추정) / null(조회 실패, 판단 보류)
   */
  private async isOrderStillOpen(
    marketCache: Map<string, MarketLike | null>,
    baseMintAddress: string,
    traderPubkey: string,
    sequenceNumber?: number,
    orderPrice?: number,
    orderSide?: string,
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

      const openOrders = market.openOrders();
      // claimedSeats는 인덱스 기반 배열이라 사용되지 않은 슬롯이 undefined일 수 있음.
      // findIndex로 원본 인덱스를 보존하되, undefined 요소에서 toBase58() 호출을 방지한다.
      const seats = market.claimedSeats();
      const traderIndex = seats.findIndex((s) => {
        if (!s) return false;
        try {
          return s.trader.toBase58() === traderPubkey;
        } catch {
          return false;
        }
      });
      if (traderIndex === -1) {
        // 이 트레이더는 현재 이 마켓에서 seat를 점유하지 않음 — 주문이 있을 수 없음
        // → 체결되거나 취소된 것으로 간주 (false = 사라짐)
        return false;
      }

      // 이 트레이더의 open orders만 필터링
      const myOrders = openOrders.filter((o) => o.traderIndex === traderIndex);

      // 1차: sequenceNumber 정확 매칭
      if (sequenceNumber != null) {
        const match = myOrders.some((o) => this.toBigNumber(o.sequenceNumber) === sequenceNumber);
        return match;
      }

      // 2차: price + side 매칭 (sequenceNumber가 없는 경우)
      if (orderPrice != null && orderSide) {
        const expectedIsBid = orderSide === 'buy';
        const match = myOrders.some((o) => {
          const oPrice = this.toBigNumber(o.price);
          // Manifest price는 quote atoms 단위(USDT 6 decimals). DB의 price는 USDT 단위.
          const oPriceUsdt = oPrice / 1e6;
          return o.isBid === expectedIsBid && Math.abs(oPriceUsdt - orderPrice) < 1e-6;
        });
        return match;
      }

      // 둘 다 없으면 판단 불가
      return null;
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
