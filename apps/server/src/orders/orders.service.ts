import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { MANIFEST, USDT_MINT, USDC_MINT } from '@solwallet/config';
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
   * Manifest에 보낼 clientOrderId 생성 — DB order.id(UUID) 기반 해시
   *
   * Manifest API 제약: 0 ~ 2147483647 (31-bit unsigned int)
   * 기존 Date.now()는 1.7e12로 범위 초과 → "clientOrderId must be an integer
   * between 0 and 2147483647" 에러 발생.
   *
   * UUID를 해시하여 31비트로 변환 → 고유성 + Manifest 제약 동시 만족.
   * (2^31 = 21억 공간에서 32비트 해시 충돌 확률은 무시 가능 수준)
   */
  private generateClientOrderId(orderId: string): number {
    let hash = 0;
    for (let i = 0; i < orderId.length; i++) {
      // FNV-1a 변형: 간단하면서 균등 분포
      hash = (hash * 31 + orderId.charCodeAt(i)) >>> 0;
    }
    // 1 ~ 2147483647 (0은 Manifest에서 유효하지 않을 수 있어 1부터 사용)
    return (hash % 2147483646) + 1;
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
   *
   * 매도(side=sell) 시: base 토큰의 ATA 필요. 없으면 setupTx에 ATA 생성 tx 반환.
   * 매수(side=buy) 시: quote 토큰(USDT/USDC)의 ATA 필요. 없으면 setupTx에 ATA 생성 tx 반환.
   * 클라이언트는 setupTx가 있으면 먼저 서명/제출 후 주문 tx를 진행해야 함.
   */
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<{ order: Record<string, unknown>; unsignedTx: string; setupTx?: string }> {
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

    // ── 필요한 ATA 존재 여부 확인 ──
    // 매도: base 토큰(예: SOL→wSOL) ATA 필요
    // 매수: quote 토큰(USDT/USDC) ATA 필요 (SOL 매수 시엔 USDT/USDC ATA)
    // SOL의 경우 Manifest는 wSOL(NATIVE_MINT) ATA를 사용
    const quoteMintAddress = token.symbol === 'SOL' ? USDC_MINT : USDT_MINT;
    const baseMintAddress = token.mint_address;
    const traderPubkey = new PublicKey(walletPublicKey);

    // 거래에 필요한 deposit mint 결정
    // 매도면 base 토큰을 deposit, 매수면 quote 토큰을 deposit
    const depositMint = dto.side === 'sell'
      ? new PublicKey(baseMintAddress)
      : new PublicKey(quoteMintAddress);

    // SOL 매도의 경우 Manifest는 wSOL ATA 사용
    const isNativeSol = depositMint.equals(NATIVE_MINT);

    // ATA가 존재하는지 RPC로 확인
    let needsAtaSetup = false;
    try {
      if (isNativeSol) {
        // wSOL ATA — getAccountInfo로 직접 확인
        const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, traderPubkey, true);
        const acctRes = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getAccountInfo',
            params: [wsolAta.toBase58(), { encoding: 'base64' }],
          }),
        });
        const acctData = await acctRes.json() as { result?: { value: unknown } };
        if (!acctData.result?.value) needsAtaSetup = true;
      } else {
        // 일반 SPL 토큰 ATA
        const ata = getAssociatedTokenAddressSync(depositMint, traderPubkey);
        const acctRes = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getAccountInfo',
            params: [ata.toBase58(), { encoding: 'base64' }],
          }),
        });
        const acctData = await acctRes.json() as { result?: { value: unknown } };
        if (!acctData.result?.value) needsAtaSetup = true;
      }
    } catch (err) {
      this.logger.warn(`ATA check failed, assuming setup needed: ${err instanceof Error ? err.message : String(err)}`);
      needsAtaSetup = true;
    }

    // ATA가 없으면 setup tx 생성 — idempotent create ATA instruction 포함
    let setupTx: string | undefined;
    if (needsAtaSetup) {
      try {
        const ataAddress = isNativeSol
          ? getAssociatedTokenAddressSync(NATIVE_MINT, traderPubkey, true)
          : getAssociatedTokenAddressSync(depositMint, traderPubkey);

        const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          traderPubkey, // payer
          ataAddress,   // associated token account
          traderPubkey, // owner
          isNativeSol ? NATIVE_MINT : depositMint,
        );

        // fresh blockhash로 legacy 트랜잭션 빌드 (ATA 생성은 단순)
        const bhRes = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [] }),
        });
        const bhData = await bhRes.json() as { result?: { value?: { blockhash: string; lastValidBlockHeight: number } } };
        const blockhash = bhData.result?.value?.blockhash;
        const lastValidBlockHeight = bhData.result?.value?.lastValidBlockHeight ?? 0;

        if (blockhash) {
          const setupTransaction = new Transaction({
            feePayer: traderPubkey,
            blockhash,
            lastValidBlockHeight,
          }).add(createAtaIx);

          // SOL 매도 시 wSOL ATA는 생성만 하고 자금은 deposit에서 wrapping됨
          setupTx = setupTransaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }).toString('base64');

          this.logger.log(`ATA setup tx created for ${dto.side} ${token.symbol} (wallet ${walletPublicKey.slice(0, 8)}...)`);
        }
      } catch (err) {
        this.logger.error(`Failed to build ATA setup tx: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 수수료 계산 — DB에서 동적 수수료율 조회 (실패 시 기본값 1%)
    const feeRate = await this.settingsService.getFeeRate();
    const total = dto.price * dto.quantity;
    const fee = total * feeRate;

    // DB에 주문 저장 (초기 상태: pending — unsigned tx 획득 후 active로 변경)
    // clientOrderId는 order.id(UUID) 기반으로 생성하므로 INSERT 후에 계산
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
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create order: ${error.message}`);
      throw error;
    }

    // order.id(UUID) 기반으로 Manifest 호환 clientOrderId 생성 (31-bit int)
    const clientOrderId = this.generateClientOrderId(order.id);

    // Manifest API에 unsigned 트랜잭션 요청 (문서 스펙 준수)
    let unsignedTx = '';
    let requestId = '';
    try {
      const quoteMint = token.symbol === 'SOL' ? USDC_MINT : USDT_MINT;
      // Manifest API requires valid tick size and step size. 
      // Ensure we don't pass excessive decimals that cause errors.
      const formattedSize = Number(dto.quantity).toFixed(token.decimals);
      // For price, quote token decimals (USDC/USDT is 6)
      const formattedPrice = Number(dto.price).toFixed(6);

      const manifestRes = await fetch(`${this.manifestBaseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maker: walletPublicKey,
          baseMint: token.mint_address, // base = 토큰 (고정)
          quoteMint: quoteMint,
          orders: [
            {
              size: formattedSize,
              price: formattedPrice,
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

    // 성공 시 'active' 상태로 변경 + requestId + clientOrderId 저장
    await this.client
      .from('orders')
      .update({
        status: 'active',
        manifest_request_id: requestId,
        manifest_client_order_id: clientOrderId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    return { order: order as Record<string, unknown>, unsignedTx, setupTx };
  }

  /**
   * ATA setup 트랜잭션 제출 — 첫 거래 전 토큰 계정 생성
   * 검증 없이 단순히 RPC로 전송 (ATA 생성은 idempotent)
   */
  async submitSetupTx(
    signedTx: string,
    _userId: string,
  ): Promise<{ txSignature: string }> {
    let txSignature = '';
    try {
      const rpcRes = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [signedTx, {
            encoding: 'base64',
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          }],
        }),
      });

      const rpcData = await rpcRes.json() as { result?: string; error?: { message?: string } };
      txSignature = rpcData.result || '';

      if (!txSignature) {
        throw new Error(rpcData.error?.message || 'RPC 전송 실패');
      }
    } catch (err) {
      this.logger.error(`Setup tx submit error: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('토큰 계정 생성에 실패했습니다.');
    }

    this.logger.log(`ATA setup tx submitted: ${txSignature.slice(0, 12)}...`);
    return { txSignature };
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
    // skipPreflight: true — Manifest tx의 blockhash가 preflight simulation에서
    // 만료 판정되는 것을 방지. 실제 네트워크 제출은 fresh blockhash로 처리됨.
    // maxRetries: RPC 노드가 자동 재시도하도록 설정.
    let txSignature = '';
    let lastError = '';
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const rpcRes = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendTransaction',
            params: [signedTx, {
              encoding: 'base64',
              skipPreflight: true,
              maxRetries: 3,
              preflightCommitment: 'confirmed',
            }],
          }),
        });

        const rpcData = await rpcRes.json() as { result?: string; error?: { message?: string } };
        txSignature = rpcData.result || '';

        if (txSignature) break; // 성공

        lastError = rpcData.error?.message || 'RPC 전송 실패';
        // blockhash 만료/슬롯 관련 에러는 재시도 의미 없음 → 즉시 중단
        if (/blockhash|BlockhashNotFound|not found/i.test(lastError)) {
          throw new Error(lastError);
        }
        // 기타 에러는 잠시 대기 후 재시도
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (/blockhash|BlockhashNotFound/i.test(lastError)) {
          break; // blockhash 에러는 재시도 불가
        }
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    if (!txSignature) {
      this.logger.error(`RPC submit error: ${lastError}`);
      // blockhash 만료 에러는 사용자에게 명확한 안내
      if (/blockhash|BlockhashNotFound/i.test(lastError)) {
        throw new BadRequestException('트랜잭션이 만료되었습니다. 다시 시도해주세요.');
      }
      throw new BadRequestException('트랜잭션 제출에 실패했습니다.');
    }

    // tx 전송 후 on-chain confirm 대기
    // skipPreflight: true로 RPC가 tx를 받아도 실제로 드롭될 수 있음
    // confirmTransaction으로 실제 블록 포함 여부를 확인
    const connection = new Connection(this.rpcUrl, 'confirmed');
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const confirmed = await connection.confirmTransaction(
        { signature: txSignature, blockhash, lastValidBlockHeight },
        'confirmed',
      );

      if (!confirmed.value || confirmed.value.err) {
        // 트랜잭션이 드롭되거나 실패 — DB에 기록하지 않고 에러 반환
        this.logger.warn(
          `Tx ${txSignature} not confirmed (dropped or failed). err=${JSON.stringify(confirmed.value?.err)}`,
        );
        throw new BadRequestException('트랜잭션이 체인에 반영되지 않았습니다. 다시 시도해주세요.');
      }
    } catch (err) {
      // TimeoutError(confirm 실패)도 포함
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`Tx confirmation timeout or error: ${txSignature} — ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('트랜잭션 컨펌 대기 시간 초과. 체인 상태를 확인 후 다시 시도해주세요.');
    }

    // DB 업데이트 — on-chain confirm 확인 후 'submitted' 상태로
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
   * 주문 생성 직후 서명 전 — Manifest에서 fresh blockhash의 unsigned tx 재요청
   *
   * createOrder에서 반환된 unsignedTx는 시간 경과로 blockhash가 만료될 수 있음.
   * 클라이언트가 서명 직전 이 엔드포인트를 호출하면, 동일 파라미터로 Manifest를 재호출하여
   * fresh blockhash가 포함된 새 unsigned tx를 반환.
   */
  async getFreshOrderTx(
    orderId: string,
    userId: string,
  ): Promise<{ unsignedTx: string }> {
    // 주문 + 토큰 + 지갑 조회
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
      throw new BadRequestException('유효하지 않은 주문입니다.');
    }

    const { data: token } = await this.client
      .from('tokens')
      .select('*')
      .eq('id', order.token_id)
      .single();

    if (!token) {
      throw new BadRequestException('토큰 정보를 찾을 수 없습니다.');
    }

    const { data: wallet } = await this.client
      .from('wallets')
      .select('public_key')
      .eq('id', order.wallet_id)
      .single();

    if (!wallet) {
      throw new BadRequestException('지갑 정보를 찾을 수 없습니다.');
    }

    const clientOrderId = order.manifest_client_order_id as number;
    const quoteMint = token.symbol === 'SOL' ? USDC_MINT : USDT_MINT;
    const formattedSize = Number(order.quantity).toFixed(token.decimals);
    const formattedPrice = Number(order.price).toFixed(6);

    // Manifest POST 재호출 — 동일 clientOrderId 사용
    const manifestRes = await fetch(`${this.manifestBaseUrl}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maker: wallet.public_key,
        baseMint: token.mint_address,
        quoteMint,
        orders: [
          {
            size: formattedSize,
            price: formattedPrice,
            side: order.side,
            orderType: 'limit',
            clientOrderId,
          },
        ],
        computeUnitPrice: MANIFEST.computeUnitPrice,
      }),
    });

    const manifestData = (await manifestRes.json()) as ManifestCreateResponse;

    if (!manifestRes.ok || !manifestData.transaction) {
      this.logger.warn(
        `Manifest fresh-tx failed: ${manifestRes.status} — ${manifestData.error || ''}: ${manifestData.cause || ''}`,
      );
      throw new BadRequestException('fresh 트랜잭션 생성에 실패했습니다. 다시 시도해주세요.');
    }

    // requestId가 새로 오면 업데이트 (선택적)
    if (manifestData.requestId) {
      await this.client
        .from('orders')
        .update({ manifest_request_id: manifestData.requestId })
        .eq('id', orderId);
    }

    return { unsignedTx: manifestData.transaction };
  }

  /**
   * 취소 서명 전 — Manifest에서 fresh blockhash의 unsigned cancel tx 재요청
   */
  async getFreshCancelTx(
    orderId: string,
    userId: string,
  ): Promise<{ unsignedTx: string }> {
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

    const { data: token } = await this.client
      .from('tokens')
      .select('*')
      .eq('id', order.token_id)
      .single();

    if (!token) {
      throw new BadRequestException('토큰 정보를 찾을 수 없습니다.');
    }

    const { data: wallet } = await this.client
      .from('wallets')
      .select('public_key')
      .eq('id', order.wallet_id)
      .single();

    if (!wallet) {
      throw new BadRequestException('지갑 정보를 찾을 수 없습니다.');
    }

    const clientOrderId = order.manifest_client_order_id as number | null;
    const sequenceNumber = order.manifest_sequence_number as number | null;
    const quoteMint = token.symbol === 'SOL' ? USDC_MINT : USDT_MINT;

    // Manifest DELETE 재호출 — 동일 파라미터로 fresh cancel tx 획득
    const cancelRes = await fetch(`${this.manifestBaseUrl}/orders`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maker: wallet.public_key,
        baseMint: token.mint_address,
        quoteMint,
        orders: [
          sequenceNumber != null
            ? { sequenceNumber }
            : { clientOrderId: clientOrderId ?? 0 },
        ],
        computeUnitPrice: MANIFEST.computeUnitPrice,
      }),
    });

    const cancelData = (await cancelRes.json()) as ManifestCancelResponse;

    if (!cancelRes.ok || !cancelData.transaction) {
      const errMsg = cancelData.error || '';
      const cause = cancelData.cause || '';
      this.logger.warn(
        `Manifest fresh cancel-tx failed: ${cancelRes.status} — ${errMsg}: ${cause}`,
      );

      // on-chain에 주문이 존재하지 않는 경우 → DB를 expired 처리
      if (/setup ixs|not found|no such order|order not found/i.test(errMsg + ' ' + cause)) {
        await this.client
          .from('orders')
          .update({ status: 'expired', updated_at: new Date().toISOString() })
          .eq('id', orderId);
        throw new BadRequestException('이 주문은 체인에 등록되지 않았습니다. 이미 만료된 주문입니다.');
      }

      throw new BadRequestException('취소 트랜잭션 생성에 실패했습니다. 다시 시도해주세요.');
    }

    return { unsignedTx: cancelData.transaction };
  }

  /**
   * 활성 주문 목록 (active + submitted 포함)
   */
  async getActiveOrders(userId: string) {
    const { data, error } = await this.client
      .from('orders')
      .select('*, tokens(symbol)')  // token symbol join
      .eq('user_id', userId)
      .in('status', ['active', 'submitted'])
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to get active orders: ${error.message}`);
      throw error;
    }

    // tokens.symbol 평탄화 — 클라이언트에서 token_symbol로 접근 가능하도록
    return (data || []).map((row: any) => ({
      ...row,
      token_symbol: row.tokens?.symbol ?? null,
    }));
  }

  /**
   * 과거 주문 내역 (filled, cancelled, expired, failed)
   * cursor 기반 페이지네이션 — before 시각보다 이전 주문을 limit만큼 반환
   */
  async getOrderHistory(userId: string, before?: string, limit = 20) {
    let query = this.client
      .from('orders')
      .select('*, tokens(symbol)', { count: 'exact' })  // token symbol join
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
    // token symbol 평탄화 — 클라이언트에서 token_symbol로 접근 가능하도록
    const items = (data || []).map((row: any) => ({
      ...row,
      token_symbol: row.tokens?.symbol ?? null,
    }));
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
      .select('*')
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
          quoteMint: token.symbol === 'SOL' ? USDC_MINT : USDT_MINT,
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
        const errMsg = cancelData.error || '';
        const cause = cancelData.cause || '';
        this.logger.warn(
          `Manifest cancel failed: ${cancelRes.status} — ${errMsg}: ${cause}`,
        );
        // on-chain에 주문이 존재하지 않는 경우 → DB를 expired 처리
        if (/setup ixs|not found|no such order|order not found/i.test(errMsg + ' ' + cause)) {
          await this.client
            .from('orders')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', order.id);
          throw new BadRequestException('이 주문은 체인에 등록되지 않았습니다. 이미 만료된 주문입니다.');
        }
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err; // 위에서 던진 에러 재throw
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
          params: [signedTx, {
            encoding: 'base64',
            skipPreflight: true,
            maxRetries: 3,
            preflightCommitment: 'confirmed',
          }],
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

    // cancel tx on-chain confirm 대기
    const connection = new Connection(this.rpcUrl, 'confirmed');
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const confirmed = await connection.confirmTransaction(
        { signature: txSignature, blockhash, lastValidBlockHeight },
        'confirmed',
      );

      if (!confirmed.value || confirmed.value.err) {
        this.logger.warn(`Cancel tx ${txSignature} not confirmed. err=${JSON.stringify(confirmed.value?.err)}`);
        throw new BadRequestException('취소 트랜잭션이 체인에 반영되지 않았습니다. 다시 시도해주세요.');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`Cancel tx confirmation timeout: ${txSignature}`);
      throw new BadRequestException('취소 컨펌 대기 시간 초과. 다시 시도해주세요.');
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
  async getOrderbook(tokenMint: string, quoteMint: string = USDT_MINT) {
    try {
      // 동적 import — SDK가 서버 시작 시 무거운 초기화를 하지 않도록 lazy 로드
      const { Market } = await import('@cks-systems/manifest-sdk');

      const baseMint = new PublicKey(tokenMint);
      const quoteMintKey = new PublicKey(quoteMint);

      // base/quote 쌍의 마켓 조회
      const markets = await Market.findByMints(this.connection, baseMint, quoteMintKey);

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
