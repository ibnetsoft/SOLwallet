import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * 주문 체결 감지 서비스
 *
 * 1. submitted 주문: tx가 블록에 포함되었는지 확인 → active (orderbook 등록)
 * 2. active 주문: 주문 tx 로그에서 fill 이벤트 파싱 → 실제 체결 여부/수량
 *    - Manifest는 tx 로그에 "Program data: <base64>"로 fill 이벤트를 기록
 *    - fillDiscriminant(8바이트)로 fill 이벤트 식별 후 FillLog 역직렬화
 */

interface SubmittedOrder {
  id: string;
  tx_signature: string;
  quantity: string | number;
  side: string;
  created_at: string;
}

interface RpcTransactionResponse {
  meta?: {
    err?: unknown | null;
    logMessages?: string[];
  } | null;
  slot?: number;
  blockTime?: number | null;
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

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') || '';
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
   * active 주문 처리 — tx 로그에서 fill 이벤트 파싱하여 실제 체결 감지
   */
  private async checkActiveOrders(): Promise<{ filled: number; failed: number; expired: number; pending: number }> {
    const { data: orders, error } = await this.client
      .from('orders')
      .select('id, tx_signature, quantity, side, created_at')
      .eq('status', 'active')
      .not('tx_signature', 'is', null)
      .order('created_at', { ascending: false })
      .limit(this.BATCH_SIZE);

    if (error || !orders || orders.length === 0) {
      return { filled: 0, failed: 0, expired: 0, pending: 0 };
    }

    let filled = 0;
    let expired = 0;
    let pending = 0;

    for (const order of orders as unknown as SubmittedOrder[]) {
      const ageMs = Date.now() - new Date(order.created_at).getTime();
      if (ageMs > this.ORDER_TIMEOUT_MS) {
        await this.updateOrderStatus(order.id, 'expired');
        expired++;
        continue;
      }

      // tx 로그에서 fill 이벤트 확인
      const fillResult = await this.checkFillFromTxLogs(order.tx_signature, order.id);

      if (fillResult.filled) {
        // 체결됨 — filled_qty 업데이트
        const fillQty = fillResult.baseAtomsTokens ?? order.quantity;
        await this.updateOrderStatus(order.id, 'filled', fillQty);
        filled++;
        this.logger.log(
          `[active] order ${order.id} FILLED — qty=${fillQty} quote=${fillResult.quoteAtomsTokens ?? 'N/A'}`,
        );
      } else if (fillResult.checked) {
        // fill 이벤트 없음 — 아직 미체결 (orderbook에 있음)
        pending++;
      } else {
        // 로그 조회 실패
        pending++;
      }
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
