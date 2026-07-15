import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ConfigService } from '@nestjs/config';
import { FEE_RATE, MANIFEST } from '@solwallet/config';
import type { CreateOrderDto } from '../common/dto/order.dto';

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
   * walletId 소유권 검증 — 해당 지갑이 userId 소유인지 확인
   */
  private async verifyWalletOwnership(walletId: string, userId: string): Promise<string> {
    const { data: wallet, error } = await this.client
      .from('wallets')
      .select('public_key')
      .eq('id', walletId)
      .eq('user_id', userId)
      .single();

    if (error || !wallet) {
      throw new BadRequestException('유효하지 않거나 소유하지 않은 지갑입니다.');
    }
    return wallet.public_key;
  }

  /**
   * 주문 생성 — DB 저장 + Manifest API에서 unsigned tx 반환
   */
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<{ order: Record<string, unknown>; unsignedTx: string }> {
    // 지갑 소유권 검증 + public key 획득
    const walletPublicKey = await this.verifyWalletOwnership(dto.walletId, userId);

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
    const total = dto.price * dto.quantity;
    const fee = total * FEE_RATE;

    // DB에 주문 저장 (초기 상태: pending — unsigned tx 획득 후 active로 변경)
    const { data: order, error } = await this.client
      .from('orders')
      .insert({
        user_id: userId,
        wallet_id: dto.walletId,
        token_id: dto.tokenId,
        side: dto.side,
        order_type: 'limit',
        price: dto.price,
        quantity: dto.quantity,
        fee: fee.toFixed(6),
        fee_rate: FEE_RATE,
        status: 'pending',
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
          owner: walletPublicKey, // public key 사용 (UUID 아님)
          baseTokenMint: dto.side === 'buy'
            ? 'So11111111111111111111111111111111111111112'
            : token.mint_address,
          quoteTokenMint: dto.side === 'buy'
            ? token.mint_address
            : 'So11111111111111111111111111111111111111112',
          side: dto.side,
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

    // Manifest 실패 시 주문을 'failed' 상태로 업데이트
    if (!unsignedTx) {
      await this.client
        .from('orders')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', order.id);
      throw new BadRequestException('트랜잭션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    // 성공 시 'active' 상태로 변경
    await this.client
      .from('orders')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', order.id);

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
    // 주문 소유자 + 상태 확인
    const { data: order, error: fetchError } = await this.client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !order) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }

    if (order.status !== 'active') {
      throw new BadRequestException('이미 처리되었거나 유효하지 않은 주문입니다.');
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

    // DB 업데이트 — 'submitted' 상태로 (active와 구분)
    const { error: updateError } = await this.client
      .from('orders')
      .update({
        tx_signature: txSignature,
        status: 'submitted', // 제출됨 (체결 대기와 구분)
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      this.logger.error(`Failed to update order: ${updateError.message}`);
    }

    return { txSignature };
  }

  /**
   * 활성 주문 목록 (active + submitted 포함)
   */
  async getActiveOrders(userId: string) {
    const { data, error } = await this.client
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'submitted'])
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to get active orders: ${error.message}`);
      throw error;
    }

    return (data || []) as Record<string, unknown>[];
  }

  /**
   * 과거 주문 내역 (filled, cancelled, expired, failed)
   */
  async getOrderHistory(userId: string) {
    const { data, error } = await this.client
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['filled', 'cancelled', 'expired', 'failed'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      this.logger.error(`Failed to get order history: ${error.message}`);
      throw error;
    }

    return (data || []) as Record<string, unknown>[];
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
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }

    if (!['active', 'submitted'].includes(order.status)) {
      throw new BadRequestException('취소할 수 없는 주문입니다.');
    }

    // Manifest에서 취소 시도 (실패해도 DB 업데이트)
    if (order.manifest_order_id) {
      try {
        const res = await fetch(`${this.manifestBaseUrl}/orders/${order.manifest_order_id}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          this.logger.warn(`Manifest cancel failed: ${res.status}`);
        }
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
