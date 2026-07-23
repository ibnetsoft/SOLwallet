import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * 주문 체결 감지 서비스
 *
 * submitted 상태 주문의 tx_signature를 RPC에서 확인하여:
 * - 트랜잭션 성공 → 체결 완료 (status='filled', filled_qty 업데이트)
 * - 트랜잭션 실패 → status='failed'
 * - 미확정(블록 미포함) → 다음 폴링에서 재시도
 * - 오래된 미확정 (1시간+) → status='expired'
 */

interface SubmittedOrder {
  id: string;
  tx_signature: string;
  quantity: string | number;
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

  /** submitted 주문을 타임아웃 처리할 기준 (1시간) */
  private readonly ORDER_TIMEOUT_MS = 60 * 60 * 1000;
  /** 단일 폴링에서 처리할 최대 주문 수 (RPC 부하 방지) */
  private readonly BATCH_SIZE = 20;

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
   * submitted 주문들의 체결 상태를 확인하고 DB 업데이트
   */
  async checkPendingOrders(): Promise<{ filled: number; failed: number; expired: number; pending: number }> {
    // submitted 주문 조회
    const { data: orders, error } = await this.client
      .from('orders')
      .select('id, tx_signature, quantity, created_at')
      .eq('status', 'submitted')
      .not('tx_signature', 'is', null)
      .order('created_at', { ascending: false })
      .limit(this.BATCH_SIZE);

    if (error || !orders || orders.length === 0) {
      return { filled: 0, failed: 0, expired: 0, pending: 0 };
    }

    let filled = 0;
    let failed = 0;
    let expired = 0;
    let pending = 0;

    for (const order of orders as unknown as SubmittedOrder[]) {
      // 1시간 초과 미확정 주문 → expired
      const ageMs = Date.now() - new Date(order.created_at).getTime();
      if (ageMs > this.ORDER_TIMEOUT_MS) {
        await this.updateOrderStatus(order.id, 'expired');
        expired++;
        continue;
      }

      // RPC에서 트랜잭션 확인
      const result = await this.checkTransactionStatus(order.tx_signature);

      if (result === 'success') {
        await this.updateOrderStatus(order.id, 'filled', order.quantity);
        filled++;
      } else if (result === 'failed') {
        await this.updateOrderStatus(order.id, 'failed');
        failed++;
      } else {
        // 'pending' — 아직 블록에 포함되지 않음
        pending++;
      }
    }

    if (filled + failed + expired > 0) {
      this.logger.log(
        `Order status check: ${filled} filled, ${failed} failed, ${expired} expired, ${pending} pending`,
      );
    }

    return { filled, failed, expired, pending };
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
        // 트랜잭션이 아직 블록에 포함되지 않음
        return 'pending';
      }

      // meta.err가 null이면 성공, 값이 있으면 실패
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

    // 체결 시 filled_qty 업데이트 (전체 체결 가정)
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
