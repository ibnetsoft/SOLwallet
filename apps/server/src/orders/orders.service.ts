import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ConfigService } from '@nestjs/config';
import { FEE_RATE, MANIFEST } from '@solwallet/config';
import type { CreateOrderDto, Order } from '@solwallet/shared-types';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly manifestBaseUrl: string;
  private readonly rpcUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.manifestBaseUrl = MANIFEST.baseUrl;
    this.rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') || '';
  }

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * 주문 생성 — DB 저장 + Manifest API에서 unsigned tx 반환
   */
  async createOrder(
    userId: string,
    walletId: string,
    dto: CreateOrderDto,
  ): Promise<{ order: Record<string, unknown>; unsignedTx: string }> {
    // 토큰 정보 조회
    const { data: token } = await this.client
      .from('tokens')
      .select('*')
      .eq('id', dto.tokenId)
      .eq('is_active', true)
      .single();

    if (!token) {
      throw new BadRequestException('유효하지 않은 토큰입니다.');
    }

    // 수수료 계산
    const total = Number(dto.price) * Number(dto.quantity);
    const fee = total * FEE_RATE;

    // DB에 주문 저장
    const { data: order, error } = await this.client
      .from('orders')
      .insert({
        user_id: userId,
        wallet_id: walletId,
        token_id: dto.tokenId,
        side: dto.side,
        order_type: 'limit',
        price: dto.price,
        quantity: dto.quantity,
        fee: fee.toFixed(6),
        fee_rate: FEE_RATE,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create order: ${error.message}`);
      throw error;
    }

    // Manifest API에서 unsigned 트랜잭션 요청
    let unsignedTx = '';
    try {
      const manifestRes = await fetch(`${this.manifestBaseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: order.wallet_id, // TODO: 실제 public key로 교체 필요
          baseTokenMint: dto.side === 'buy'
            ? 'So11111111111111111111111111111111111111112' // SOL
            : token.mint_address,
          quoteTokenMint: dto.side === 'buy'
            ? token.mint_address
            : 'So11111111111111111111111111111111111111112', // SOL
          side: dto.side === 'buy' ? 'buy' : 'sell',
          price: dto.price,
          amount: dto.quantity,
        }),
      });

      if (manifestRes.ok) {
        const manifestData = await manifestRes.json() as { unsignedTransaction?: string };
        unsignedTx = manifestData.unsignedTransaction || '';
      } else {
        this.logger.warn(`Manifest API call failed: ${manifestRes.status}`);
      }
    } catch (err) {
      this.logger.error(`Manifest API error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { order: order as Record<string, unknown>, unsignedTx };
  }

  /**
   * 서명된 트랜잭션 제출 — Solana RPC로 전송
   */
  async submitOrder(
    orderId: string,
    signedTx: string,
    userId: string,
  ): Promise<{ txSignature: string }> {
    // 주문 소유자 확인
    const { data: order, error: fetchError } = await this.client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !order) {
      throw new BadRequestException('주문을 찾을 수 없습니다.');
    }

    if (order.status !== 'active') {
      throw new BadRequestException('이미 처리된 주문입니다.');
    }

    // Solana RPC로 트랜잭션 전송
    let txSignature = '';
    try {
      const rpcRes = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [signedTx, { encoding: 'base64' }],
        }),
      });

      const rpcData = await rpcRes.json() as { result?: string; error?: { message?: string } };
      txSignature = rpcData.result || '';

      if (!txSignature) {
        throw new Error(rpcData.error?.message || 'RPC 전송 실패');
      }
    } catch (err) {
      this.logger.error(`RPC submit error: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('트랜잭션 제출에 실패했습니다.');
    }

    // DB 업데이트
    const { error: updateError } = await this.client
      .from('orders')
      .update({
        tx_signature: txSignature,
        status: 'active', // 아직 체결 대기
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      this.logger.error(`Failed to update order: ${updateError.message}`);
    }

    return { txSignature };
  }

  /**
   * 활성 주문 목록
   */
  async getActiveOrders(userId: string): Promise<Order[]> {
    const { data, error } = await this.client
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to get active orders: ${error.message}`);
      throw error;
    }

    return (data || []) as unknown as Order[];
  }

  /**
   * 과거 주문 내역
   */
  async getOrderHistory(userId: string): Promise<Order[]> {
    const { data, error } = await this.client
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      this.logger.error(`Failed to get order history: ${error.message}`);
      throw error;
    }

    return (data || []) as unknown as Order[];
  }

  /**
   * 주문 취소
   */
  async cancelOrder(orderId: string, userId: string): Promise<{ success: boolean }> {
    const { data: order, error: fetchError } = await this.client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !order) {
      throw new BadRequestException('주문을 찾을 수 없습니다.');
    }

    if (order.status !== 'active') {
      throw new BadRequestException('취소할 수 없는 주문입니다.');
    }

    // Manifest에서 취소 시도 (실패해도 DB 업데이트)
    if (order.manifest_order_id) {
      try {
        await fetch(`${this.manifestBaseUrl}/orders/${order.manifest_order_id}`, {
          method: 'DELETE',
        });
      } catch {
        this.logger.warn('Manifest cancel failed, proceeding with DB update.');
      }
    }

    // DB 업데이트
    const { error } = await this.client
      .from('orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', orderId);

    if (error) {
      this.logger.error(`Failed to cancel order: ${error.message}`);
      throw error;
    }

    return { success: true };
  }

  /**
   * Manifest 오더북 조회 (프록시)
   */
  async getOrderbook(tokenMint: string) {
    try {
      const res = await fetch(
        `${this.manifestBaseUrl}/orders?market=${tokenMint}-So11111111111111111111111111111111111111112`,
      );

      if (!res.ok) {
        return { bids: [], asks: [], spread: 0 };
      }

      return await res.json();
    } catch {
      this.logger.warn('Failed to fetch orderbook from Manifest');
      return { bids: [], asks: [], spread: 0 };
    }
  }
}
