import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { MANIFEST, USDT_MINT } from '@solwallet/config';
import { SettingsService } from '../settings/settings.service';
import type { CreateOrderDto } from '../common/dto/order.dto';

/** Manifest POST /orders 응답 */
interface ManifestCreateResponse {
  transaction?: string;
  requestId?: string;
  error?: string;
  cause?: string;
}

/** Manifest DELETE /orders 응답 */
interface ManifestCancelResponse {
  transaction?: string;
  requestId?: string;
  cancelled?: Array<{ sequenceNumber?: string | number; clientOrderId?: string | number }>;
  warning?: string;
  error?: string;
  cause?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly manifestBaseUrl: string;
  private readonly rpcUrl: string;
  private readonly connection: Connection;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
  ) {
    this.manifestBaseUrl = MANIFEST.baseUrl;
    this.rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') || '';
    this.connection = new Connection(this.rpcUrl);
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
   * Manifest에 보낼 clientOrderId 생성 — 시간 기반 고유값
   * (취소 시 식별자로 사용)
   */
  private generateClientOrderId(): number {
    // Date.now() 범위: 1.7e12 — BIGINT(64bit) 안전
    return Date.now();
  }

  /**
   * 주문 생성 — DB 저장 + Manifest API에서 unsigned tx 반환
   *
   * Manifest API 스펙:
   *   POST /v1/orders
   *   { maker, baseMint, quoteMint, orders: [{ size, price, side, orderType, clientOrderId }], computeUnitPrice }
   *   → { transaction, requestId }
   *
   * base는 항상 토큰, quote는 항상 USDT (side 무관 — 같은 마켓에서 매수/매도 매칭)
   */
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<{ order: Record<string, unknown>; unsignedTx: string }> {
    // 지갑 소유권 검증 + public key 획득
    const walletPublicKey = await this.verifyWalletOwnership(dto.walletId, userId);

    // 토큰 정보 조회 (base)
    const { data: token } = await this.client
      .from('tokens')
      .select('*')
      .eq('id', dto.tokenId)
      .eq('is_active', true)
      .single();

    if (!token) {
      throw new BadRequestException('유효하지 않은 토큰입니다.');
    }

    // 수수료 계산 — DB에서 동적 수수료율 조회 (실패 시 기본값 1%)
    const feeRate = await this.settingsService.getFeeRate();
    const total = dto.price * dto.quantity;
    const fee = total * feeRate;

    const clientOrderId = this.generateClientOrderId();

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
        fee_rate: feeRate,
        status: 'pending',
        manifest_client_order_id: clientOrderId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create order: ${error.message}`);
      throw error;
    }

    // Manifest API에 unsigned 트랜잭션 요청 (문서 스펙 준수)
    let unsignedTx = '';
    let requestId = '';
    try {
      const manifestRes = await fetch(`${this.manifestBaseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maker: walletPublicKey,
          baseMint: token.mint_address, // base = 토큰 (고정)
          quoteMint: USDT_MINT, // quote = USDT (고정)
          orders: [
            {
              size: String(dto.quantity),
              price: String(dto.price),
              side: dto.side,
              orderType: 'limit',
              clientOrderId,
            },
          ],
          computeUnitPrice: MANIFEST.computeUnitPrice,
        }),
      });

      const manifestData = (await manifestRes.json()) as ManifestCreateResponse;

      if (manifestRes.ok && manifestData.transaction) {
        unsignedTx = manifestData.transaction;
        requestId = manifestData.requestId || '';
      } else {
        this.logger.warn(
          `Manifest API call failed: ${manifestRes.status} — ${manifestData.error || ''}: ${manifestData.cause || ''}`,
        );
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

    // 성공 시 'active' 상태로 변경 + requestId 저장
    await this.client
      .from('orders')
      .update({
        status: 'active',
        manifest_request_id: requestId,
        updated_at: new Date().toISOString(),
      })
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
        status: 'submitted',
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
   * cursor 기반 페이지네이션 — before 시각보다 이전 주문을 limit만큼 반환
   */
  async getOrderHistory(userId: string, before?: string, limit = 20) {
    let query = this.client
      .from('orders')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .in('status', ['filled', 'cancelled', 'expired', 'failed']);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error(`Failed to get order history: ${error.message}`);
      throw error;
    }

    // 다음 페이지 존재 여부 — 반환된 마지막 주문의 created_at이 cursor
    const items = (data || []) as Record<string, unknown>[];
    const hasMore = items.length === limit;
    const nextCursor = hasMore && items.length > 0
      ? (items[items.length - 1].created_at as string)
      : null;

    return { items, hasMore, nextCursor };
  }

  /**
   * 주문 취소 — 1단계: Manifest에서 unsigned cancel tx 획득
   *
   * Manifest API 스펙:
   *   DELETE /v1/orders (body로 식별)
   *   { maker, baseMint, quoteMint, orders: [{ clientOrderId } | { sequenceNumber }], computeUnitPrice }
   *   → { transaction, cancelled }
   *
   * 반환된 VersionedTransaction은 클라이언트가 서명한 후 submitCancelOrder로 제출해야 함
   */
  async cancelOrder(
    orderId: string,
    userId: string,
  ): Promise<{ order: Record<string, unknown>; unsignedTx: string }> {
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

    // 토큰 정보 (base mint)
    const { data: token } = await this.client
      .from('tokens')
      .select('mint_address')
      .eq('id', order.token_id)
      .single();

    if (!token) {
      throw new BadRequestException('토큰 정보를 찾을 수 없습니다.');
    }

    // 지갑 public key (maker)
    const { data: wallet } = await this.client
      .from('wallets')
      .select('public_key')
      .eq('id', order.wallet_id)
      .single();

    if (!wallet) {
      throw new BadRequestException('지갑 정보를 찾을 수 없습니다.');
    }

    // Manifest에 cancel tx 요청 — clientOrderId로 식별
    const clientOrderId = order.manifest_client_order_id as number | null;
    const sequenceNumber = order.manifest_sequence_number as number | null;

    let unsignedTx = '';
    try {
      const cancelRes = await fetch(`${this.manifestBaseUrl}/orders`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maker: wallet.public_key,
          baseMint: token.mint_address,
          quoteMint: USDT_MINT,
          orders: [
            sequenceNumber != null
              ? { sequenceNumber }
              : { clientOrderId: clientOrderId ?? 0 },
          ],
          computeUnitPrice: MANIFEST.computeUnitPrice,
        }),
      });

      const cancelData = (await cancelRes.json()) as ManifestCancelResponse;

      if (cancelRes.ok && cancelData.transaction) {
        unsignedTx = cancelData.transaction;
      } else {
        this.logger.warn(
          `Manifest cancel failed: ${cancelRes.status} — ${cancelData.error || ''}: ${cancelData.cause || ''}`,
        );
      }
    } catch (err) {
      this.logger.error(`Manifest cancel error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!unsignedTx) {
      throw new BadRequestException('취소 트랜잭션 생성에 실패했습니다.');
    }

    return { order: order as Record<string, unknown>, unsignedTx };
  }

  /**
   * 주문 취소 — 2단계: 서명된 cancel tx 제출
   */
  async submitCancelOrder(
    orderId: string,
    signedTx: string,
    userId: string,
  ): Promise<{ txSignature: string }> {
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

    // Solana RPC로 cancel 트랜잭션 전송
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
      this.logger.error(`RPC cancel submit error: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('취소 트랜잭션 제출에 실패했습니다.');
    }

    // DB 업데이트 — 'cancelled' 상태로
    const { error: updateError } = await this.client
      .from('orders')
      .update({
        tx_signature: txSignature,
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      this.logger.error(`Failed to update cancelled order: ${updateError.message}`);
    }

    return { txSignature };
  }

  /**
   * Manifest 오더북 조회 (프록시) — SDK로 온체인 마켓에서 bids/asks 읽기
   *
   * Manifest HTTP API에는 퍼블릭 orderbook 엔드포인트가 없으므로
   * 공식 SDK(@cks-systems/manifest-sdk)로 마켓 PDA에서 직접 조회합니다.
   */
  async getOrderbook(tokenMint: string) {
    try {
      // 동적 import — SDK가 서버 시작 시 무거운 초기화를 하지 않도록 lazy 로드
      const { Market } = await import('@cks-systems/manifest-sdk');

      const baseMint = new PublicKey(tokenMint);
      const quoteMint = new PublicKey(USDT_MINT);

      // base/quote 쌍의 마켓 조회
      const markets = await Market.findByMints(this.connection, baseMint, quoteMint);

      if (!markets || markets.length === 0) {
        return { bids: [], asks: [], spread: 0 };
      }

      const market = markets[0];

      // L2 호가창 (경쟁력 순 정렬)
      const bidOrders = market.bidsL2();
      const askOrders = market.asksL2();

      const bids = bidOrders.map((o) => ({
        price: o.tokenPrice,
        quantity: Number(o.numBaseTokens),
      }));
      const asks = askOrders.map((o) => ({
        price: o.tokenPrice,
        quantity: Number(o.numBaseTokens),
      }));

      const bestBid = bids.length > 0 ? Math.max(...bids.map((b) => b.price)) : 0;
      const bestAsk = asks.length > 0 ? Math.min(...asks.map((a) => a.price)) : 0;
      const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;

      return { bids, asks, spread };
    } catch (err) {
      this.logger.warn(`Failed to fetch orderbook from Manifest: ${err instanceof Error ? err.message : String(err)}`);
      return { bids: [], asks: [], spread: 0 };
    }
  }
}
