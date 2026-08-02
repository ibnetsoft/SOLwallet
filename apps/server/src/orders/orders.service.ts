import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createSyncNativeInstruction,
} from '@solana/spl-token';
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
    this.connection = new Connection(this.rpcUrl, {
      // setup tx 제출 직후 재시도에서 방금 만든 계정(좌석/wrapper/Global)이
      // 보여야 한다. 기본값 finalized는 최대 30초 뒤처져 "아직 준비 안 됨"이
      // 무한 반복된다.
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 30_000, // 컨펌 대기 30초
    });
  }

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * Manifest 마켓의 좌석(seat) 확보에 필요한 instruction 반환
   *
   * Manifest 주문 생성 API(`/v1/orders`)는 트레이더가 해당 마켓에 좌석이 없으면
   * setupIxs:true를 줘도 스스로 만들지 못하고
   * `Cannot read properties of null (reading 'publicKey')` 500을 낸다.
   * (좌석 있는 지갑 → 200 / 좌석 없는 지갑 → 500 으로 실측 확인)
   *
   * 그래서 좌석 생성 ix를 우리 setup tx에 포함해 먼저 온체인에 확보한다.
   * 조회 실패 시에는 setupNeeded=false로 넘겨 기존 흐름을 막지 않는다.
   */
  private async getMarketSeatSetup(
    baseMintAddress: string,
    traderPubkey: PublicKey,
  ): Promise<{
    setupNeeded: boolean;
    instructions: import('@solana/web3.js').TransactionInstruction[];
    wrapperKeypair?: Parameters<typeof Transaction.prototype.partialSign>[0];
  }> {
    const none = { setupNeeded: false, instructions: [] };
    try {
      const { Market, ManifestClient } = await import('@cks-systems/manifest-sdk');
      const markets = await Market.findByMints(
        this.connection,
        new PublicKey(baseMintAddress),
        new PublicKey(USDT_MINT),
      );
      if (!markets || markets.length === 0) {
        this.logger.warn(
          `[getMarketSeatSetup] 마켓 없음 — base=${baseMintAddress.slice(0, 8)}...`,
        );
        return none;
      }

      const setupData = await ManifestClient.getSetupIxs(
        this.connection,
        markets[0].address,
        traderPubkey,
      );
      this.logger.log(
        `[getMarketSeatSetup] base=${baseMintAddress.slice(0, 8)}... setupNeeded=${setupData.setupNeeded} ixs=${setupData.instructions.length}`,
      );
      return {
        setupNeeded: setupData.setupNeeded,
        instructions: setupData.instructions,
        wrapperKeypair: setupData.wrapperKeypair ?? undefined,
      };
    } catch (e) {
      this.logger.warn(
        `[getMarketSeatSetup] 좌석 확인 실패(무시하고 진행): ${(e as Error).message}`,
      );
      return none;
    }
  }

  /**
   * 주어진 민트들 중 Manifest Global 계정이 아직 없는 것만 반환
   *
   * Global 계정은 민트에서 파생되는 PDA로, 신규 상장 토큰은 없을 수 있다.
   * 이게 없으면 Manifest 주문 생성 API가 500으로 실패하므로 미리 확인해
   * setup tx에서 함께 생성한다. (조회 실패 시에는 "있다"고 보고 넘어가
   * 불필요한 생성 시도를 하지 않음)
   */
  private async findMissingGlobalMints(mints: string[]): Promise<string[]> {
    const missing: string[] = [];
    try {
      const { getGlobalAddress } = await import(
        '@cks-systems/manifest-sdk/dist/cjs/utils/global'
      );
      for (const mint of Array.from(new Set(mints))) {
        try {
          const globalAddr = getGlobalAddress(new PublicKey(mint));
          // ⚠️ 반드시 'confirmed'로 조회할 것.
          // Connection 기본 commitment는 'finalized'라서, 방금 setup으로 만든 Global이
          // 아직 finalize되지 않아(수십 초) "없음"으로 보였고, 그 결과 setup을 마친
          // 사용자에게 다시 setup을 요구하는 무한 루프성 안내가 떴다.
          // setup 컨펌도 'confirmed' 기준이므로 여기서도 동일하게 맞춘다.
          const info = await this.connection.getAccountInfo(globalAddr, 'confirmed');
          if (!info) missing.push(mint);
        } catch (err) {
          this.logger.warn(
            `[globalCheck] skip ${mint.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `[globalCheck] SDK load failed, skipping global setup: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    return missing;
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
  ): Promise<{
    order?: Record<string, unknown>;
    unsignedTx?: string;
    setupTx?: string;
    /** true면 주문이 아직 생성되지 않음 — setupTx를 먼저 처리하고 재요청해야 함 */
    setupRequired?: boolean;
  }> {
    this.logger.log(`[createOrder] START — user=${userId.slice(0, 8)} side=${dto.side} token=${dto.tokenId} price=${dto.price} qty=${dto.quantity}`);

    // 지갑 소유권 검증 + public key 획득
    const walletPublicKey = await this.verifyWalletOwnership(dto.walletId, userId);
    this.logger.log(`[createOrder] wallet=${walletPublicKey.slice(0, 8)}...`);

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
    const quoteMintAddress = USDT_MINT;
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

    // ── Manifest Global 계정 확인 ──
    // Manifest는 민트마다 Global 계정을 두는데, 신규 상장 토큰은 이게 없는 경우가 있다.
    // 없으면 Manifest 주문 생성 API가 내부에서 null을 참조해
    // "Cannot read properties of null (reading 'publicKey')" 500 에러로 실패한다.
    // Global 주소는 민트에서 파생되는 PDA라 아무나 rent(약 0.0016 SOL)만 내면 생성 가능.
    // → setup 단계에서 함께 만들어 신규 토큰도 별도 조치 없이 거래되도록 한다.
    const missingGlobalMints = await this.findMissingGlobalMints([
      baseMintAddress,
      quoteMintAddress,
    ]);

    // ── Manifest 마켓 좌석(seat) 확인 ──
    // Manifest 주문 생성 API는 "좌석이 없는 트레이더"를 스스로 처리하지 못하고
    // (setupIxs:true를 줘도) null 참조로 500을 낸다. 실측 비교:
    //   좌석 있음 → 200 OK / 좌석 없음 → 500 "reading 'publicKey'"
    // 따라서 좌석 생성 ix를 우리 setup tx에 포함해 먼저 확보한다.
    const marketSetup = await this.getMarketSeatSetup(baseMintAddress, traderPubkey);

    // ── setup tx (ATA 생성 + Global 생성 + 마켓 좌석 확보) ──
    let setupTx: string | undefined;
    if (needsAtaSetup || missingGlobalMints.length > 0 || marketSetup.setupNeeded) {
      try {
        const setupIxs = [];

        if (needsAtaSetup) {
          const ataAddress = isNativeSol
            ? getAssociatedTokenAddressSync(NATIVE_MINT, traderPubkey, true)
            : getAssociatedTokenAddressSync(depositMint, traderPubkey);

          setupIxs.push(
            createAssociatedTokenAccountIdempotentInstruction(
              traderPubkey, // payer
              ataAddress,   // associated token account
              traderPubkey, // owner
              isNativeSol ? NATIVE_MINT : depositMint,
            ),
          );
        }

        if (missingGlobalMints.length > 0) {
          const { ManifestClient } = await import('@cks-systems/manifest-sdk');
          for (const mint of missingGlobalMints) {
            // createGlobalCreateIx는 SDK에서 private static이지만 런타임 호출 가능.
            // payer 외에 다른 서명자가 필요 없어 사용자 서명만으로 생성된다.
            const globalIx = await (
              ManifestClient as unknown as {
                createGlobalCreateIx: (
                  c: Connection,
                  payer: PublicKey,
                  mint: PublicKey,
                ) => Promise<import('@solana/web3.js').TransactionInstruction>;
              }
            ).createGlobalCreateIx(this.connection, traderPubkey, new PublicKey(mint));
            setupIxs.push(globalIx);
            this.logger.log(`[createOrder] Global 계정 생성 ix 추가 — mint=${mint.slice(0, 8)}...`);
          }
        }

        // 마켓 좌석(seat) 확보 — 없으면 Manifest 주문 API가 500으로 실패함
        if (marketSetup.setupNeeded) {
          setupIxs.push(...marketSetup.instructions);
          this.logger.log(
            `[createOrder] 마켓 좌석 생성 ix ${marketSetup.instructions.length}개 추가`,
          );
        }

        // fresh blockhash로 legacy 트랜잭션 빌드
        const bhRes = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [] }),
        });
        const bhData = await bhRes.json() as { result?: { value?: { blockhash: string; lastValidBlockHeight: number } } };
        const blockhash = bhData.result?.value?.blockhash;
        const lastValidBlockHeight = bhData.result?.value?.lastValidBlockHeight ?? 0;

        if (blockhash && setupIxs.length > 0) {
          const setupTransaction = new Transaction({
            feePayer: traderPubkey,
            blockhash,
            lastValidBlockHeight,
          }).add(...setupIxs);

          // wrapper 계정을 새로 만드는 경우 해당 키페어 서명이 필요 — 서버가 미리 서명
          if (marketSetup.wrapperKeypair) {
            setupTransaction.partialSign(marketSetup.wrapperKeypair);
            this.logger.log('[createOrder] wrapper 키페어 pre-sign');
          }

          // 잔액 부족을 미리 잡아 명확히 안내한다.
          // 신규 토큰의 첫 거래자는 Global 계정 rent를 부담하게 되는데, SOL이 모자라면
          // 서명 후 체인에서 insufficient lamports로 실패해 원인을 알기 어렵다.
          // 실제 tx를 시뮬레이션해 필요한 금액을 정확히 뽑아 알려준다.
          // ⚠️ RPC 일시 오류로 시뮬레이션이 실패할 수 있으므로, 잔액 부족이 명확히
          //    확인될 때만 차단하고 그 외에는 그대로 진행한다(fail-open).
          try {
            const sim = await this.connection.simulateTransaction(setupTransaction);
            if (sim.value.err) {
              const logs = (sim.value.logs || []).join(' ');
              const m = logs.match(/insufficient lamports (\d+), need (\d+)/);
              if (m) {
                const needSol = Number(m[2]) / 1e9;
                const haveSol = Number(m[1]) / 1e9;
                this.logger.warn(
                  `[createOrder] setup 잔액 부족 — have=${haveSol} need=${needSol} wallet=${walletPublicKey.slice(0, 8)}`,
                );
                throw new BadRequestException(
                  `거래 준비를 위해 최소 ${needSol.toFixed(4)} SOL이 필요합니다 ` +
                    `(현재 ${haveSol.toFixed(4)} SOL). 지갑에 SOL을 충전한 뒤 다시 시도해주세요.`,
                );
              }
            }
          } catch (simErr) {
            if (simErr instanceof BadRequestException) throw simErr;
            this.logger.warn(
              `[createOrder] setup 시뮬레이션 건너뜀: ${simErr instanceof Error ? simErr.message : String(simErr)}`,
            );
          }

          setupTx = setupTransaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }).toString('base64');

          this.logger.log(
            `[createOrder] setup tx created — ata=${needsAtaSetup} global=${missingGlobalMints.length} (wallet ${walletPublicKey.slice(0, 8)}...)`,
          );
        }
      } catch (err) {
        // 잔액 부족 등 사용자에게 그대로 전달해야 하는 안내는 삼키지 않고 재throw
        if (err instanceof BadRequestException) throw err;
        this.logger.error(`Failed to build setup tx: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Global 계정이나 마켓 좌석이 없으면 Manifest 주문 생성 API가 무조건 500으로 실패한다.
    // 둘 다 사용자 서명이 있어야 만들 수 있으므로, 여기서 주문을 진행하지 말고
    // setup tx만 돌려주고 종료한다. 클라이언트가 이걸 서명·제출(컨펌까지)한 뒤
    // 주문을 다시 요청하면 그때는 정상 처리된다.
    // (주문 row를 만들기 전에 반환해 실패한 orphan 주문이 쌓이지 않도록 함)
    if (missingGlobalMints.length > 0 || marketSetup.setupNeeded) {
      if (!setupTx) {
        throw new BadRequestException(
          '거래 준비 트랜잭션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.',
        );
      }
      const reasons = [
        missingGlobalMints.length > 0
          ? `global=${missingGlobalMints.map((m) => m.slice(0, 8)).join(',')}`
          : null,
        marketSetup.setupNeeded ? 'seat' : null,
      ].filter(Boolean);
      this.logger.log(
        `[createOrder] SETUP REQUIRED — ${reasons.join(' ')} → 주문 보류하고 setupTx 반환`,
      );
      return { setupRequired: true, setupTx };
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
        order_type: dto.orderType || 'limit',
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
    this.logger.log(`[createOrder] order saved: id=${order.id} clientOrderId=${clientOrderId}`);

    // Manifest API에 unsigned 트랜잭션 요청 (문서 스펙 준수)
    let unsignedTx = '';
    let requestId = '';
    let manifestErrorDetail = '';
    try {
      const quoteMint = USDT_MINT;
      this.logger.log(`[createOrder] calling Manifest POST /orders — baseMint=${token.mint_address.slice(0, 8)} quoteMint=${quoteMint.slice(0, 8)}`);
      // Manifest API requires valid tick size and step size. 
      // Ensure we don't pass excessive decimals that cause errors.
      const formattedSize = Number(dto.quantity).toFixed(token.decimals);

      // 시장가일 때: 매도는 매우 낮은 가격(0.01)으로 모든 매수 호가 매칭,
      // 매수는 매우 높은 가격(999999)으로 모든 매도 호가 매칭
      // Manifest는 가격 기반 매칭 — 극단 가격으로 전체 호가 스캔
      let orderPrice = dto.price;
      if (dto.orderType === 'market') {
        orderPrice = dto.side === 'sell' ? 0.01 : 999999;
        this.logger.log(`[createOrder] market ${dto.side} — using extreme price: ${orderPrice}`);
      }

      const formattedPrice = Number(orderPrice).toFixed(6);

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
              // 시장가 = timeInForce + expirySlots (150슬롯 ≈ 60초 후 자동 만료)
              orderType: dto.orderType === 'market' ? 'timeInForce' : 'limit',
              ...(dto.orderType === 'market' ? { expirySlots: 150 } : {}),
              clientOrderId,
            },
          ],
          computeUnitPrice: MANIFEST.computeUnitPrice,
          setupIxs: true,
        }),
      });

      const manifestData = (await manifestRes.json()) as ManifestCreateResponse;

      if (manifestRes.ok && manifestData.transaction) {
        unsignedTx = manifestData.transaction;
        requestId = manifestData.requestId || '';
        this.logger.log(`[createOrder] Manifest OK — requestId=${requestId} txLen=${unsignedTx.length}`);
      } else {
        manifestErrorDetail = `${manifestData.error || ''}: ${manifestData.cause || ''}`;
        this.logger.warn(
          `[createOrder] Manifest failed: ${manifestRes.status} — ${manifestErrorDetail}`,
        );
      }
    } catch (err) {
      this.logger.error(`[createOrder] Manifest API error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Manifest 실패 시 주문을 'failed' 상태로 업데이트
    if (!unsignedTx) {
      this.logger.error(`[createOrder] FAIL — no unsignedTx, order=${order.id} → status=failed`);
      await this.client
        .from('orders')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', order.id);

      // "Cannot read properties of null" 계열은 DEX가 아직 해당 마켓/계정을 인식하지
      // 못한 상태 — 신규 상장 직후 DEX 반영이 늦어질 때 발생한다. 일반 문구로 뭉개면
      // 원인 파악이 불가능하므로 상황을 구체적으로 안내한다.
      if (/reading 'publicKey'|Cannot read properties of null/i.test(manifestErrorDetail)) {
        throw new BadRequestException(
          '거래소가 아직 이 토큰의 마켓 정보를 인식하지 못했습니다. ' +
            '신규 상장 직후에는 반영까지 몇 분 걸릴 수 있으니 잠시 후 다시 시도해주세요.',
        );
      }
      throw new BadRequestException(
        manifestErrorDetail.trim().replace(/^:\s*|\s*:$/g, '')
          ? `주문 생성에 실패했습니다: ${manifestErrorDetail.replace(/^:\s*|\s*:$/g, '')}`
          : '트랜잭션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
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
   * Setup 트랜잭션 제출 — ATA 생성 (fire-and-forget)
   * ATA 생성은 idempotent하므로 컨펌 대기 불필요
   */
  async submitSetupTx(
    signedTx: string,
    _userId: string,
  ): Promise<{ txSignature: string }> {
    this.logger.log(`[submitSetupTx] START — txLen=${signedTx.length}`);
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
      this.logger.error(`Setup tx submit error: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('트랜잭션 제출에 실패했습니다.');
    }

    // 온체인 컨펌 대기 — setup(ATA/Global 생성)이 확정돼야 이어지는 주문 생성이 성공한다.
    // 예전엔 fire-and-forget이라, Global 생성 직후 재요청하면 아직 계정이 없어 다시 실패했음.
    try {
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
      const confirmed = await this.connection.confirmTransaction(
        { signature: txSignature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      if (!confirmed.value || confirmed.value.err) {
        this.logger.warn(
          `[submitSetupTx] NOT CONFIRMED — tx=${txSignature} err=${JSON.stringify(confirmed.value?.err)}`,
        );
        throw new BadRequestException('거래 준비 트랜잭션이 체인에 반영되지 않았습니다. 다시 시도해주세요.');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(
        `[submitSetupTx] confirm timeout: ${txSignature} — ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException('거래 준비 컨펌이 지연되었습니다. 잠시 후 다시 시도해주세요.');
    }

    this.logger.log(`[submitSetupTx] CONFIRMED — tx=${txSignature.slice(0, 12)}...`);
    return { txSignature };
  }

  /**
   * wSOL 래핑 트랜잭션 제출 — RPC 전송 후 온체인 컨펌 확인
   * wrapTx가 컨펌되어야 이후 Manifest 주문 tx의 wSOL deposit이 성공함
   */
  async submitWrapTx(
    signedTx: string,
    _userId: string,
  ): Promise<{ txSignature: string }> {
    this.logger.log(`[submitWrapTx] START — txLen=${signedTx.length}`);
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
      this.logger.log(`[submitWrapTx] tx sent to RPC: ${txSignature.slice(0, 12)}...`);
    } catch (err) {
      this.logger.error(`[submitWrapTx] RPC error: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('wSOL 래핑 트랜잭션 제출에 실패했습니다.');
    }

    // wSOL 래핑이 온체인에 반영되었는지 확인
    try {
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
      this.logger.log(`[submitWrapTx] waiting for confirm: ${txSignature.slice(0, 12)}...`);
      const confirmed = await this.connection.confirmTransaction(
        { signature: txSignature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      if (!confirmed.value || confirmed.value.err) {
        this.logger.warn(`[submitWrapTx] NOT CONFIRMED — tx=${txSignature} err=${JSON.stringify(confirmed.value?.err)}`);
        throw new BadRequestException('wSOL 래핑이 체인에 반영되지 않았습니다. 다시 시도해주세요.');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`[submitWrapTx] confirm timeout: ${txSignature} — ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('wSOL 래핑 컨펌이 지연되었습니다. 다시 시도해주세요.');
    }

    this.logger.log(`[submitWrapTx] CONFIRMED — tx=${txSignature.slice(0, 12)}...`);
    return { txSignature };
  }

  /**
   * SOL 매도 시 wSOL 래핑 tx 생성 — 서명 직전 fresh blockhash로 생성
   *
   * createOrder에서는 wrapTx를 반환하지 않음 (blockhash 만료 우려).
   * 클라이언트가 서명 직전 이 엔드포인트를 호출하여 fresh wrap tx를 획득.
   */
  async getWrapTx(orderId: string, userId: string): Promise<{ wrapTx: string }> {
    this.logger.log(`[getWrapTx] START — order=${orderId}`);
    // 주문 소유자 확인
    const { data: order, error: fetchError } = await this.client
      .from('orders')
      .select('*, tokens!inner(mint_address, symbol, decimals)')
      .eq('id', orderId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !order) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }

    // SOL 매도인지 확인
    const token = order.tokens as { mint_address: string; symbol: string; decimals: number };
    const isNativeSol = new PublicKey(token.mint_address).equals(NATIVE_MINT);

    if (!isNativeSol || order.side !== 'sell') {
      throw new BadRequestException('이 주문은 wSOL 래핑이 필요하지 않습니다.');
    }

    // 지갑 public key 획득
    const { data: wallet } = await this.client
      .from('wallets')
      .select('public_key')
      .eq('id', order.wallet_id)
      .eq('user_id', userId)
      .single();

    if (!wallet?.public_key) {
      throw new BadRequestException('지갑 정보를 찾을 수 없습니다.');
    }

    const traderPubkey = new PublicKey(wallet.public_key);
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, traderPubkey, true);
    const wrapAmount = Math.floor(Number(order.quantity) * LAMPORTS_PER_SOL);

    // ATA 존재 확인 (없으면 생성 필요 — setupTx로 먼저 처리되어야 함)
    const acctInfo = await this.connection.getAccountInfo(wsolAta);
    if (!acctInfo) {
      throw new BadRequestException('wSOL 토큰 계정이 없습니다. 다시 시도하면 자동 생성됩니다.');
    }

    // 이미 충분한 wSOL 잔액이 있으면 추가 래핑 불필요
    const ataInfo = await this.connection.getParsedAccountInfo(wsolAta);
    const currentBalance = (ataInfo.value?.data as { parsed?: { info?: { tokenAmount?: { amount: string } } } })
      ?.parsed?.info?.tokenAmount?.amount || '0';
    if (BigInt(currentBalance) >= BigInt(wrapAmount)) {
      this.logger.log(`[getWrapTx] SKIP — wSOL balance ${Number(currentBalance) / LAMPORTS_PER_SOL} already >= ${wrapAmount / LAMPORTS_PER_SOL}`);
      return { wrapTx: '' };
    }

    // Fresh blockhash로 wrap tx 생성
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

    const transferIx = SystemProgram.transfer({
      fromPubkey: traderPubkey,
      toPubkey: wsolAta,
      lamports: wrapAmount,
    });
    const syncIx = createSyncNativeInstruction(wsolAta);

    const wrapTransaction = new Transaction({
      feePayer: traderPubkey,
      blockhash,
      lastValidBlockHeight,
    }).add(transferIx, syncIx);

    const wrapTx = wrapTransaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');

    this.logger.log(`[getWrapTx] DONE — ${wrapAmount / LAMPORTS_PER_SOL} SOL (wallet ${wallet.public_key.slice(0, 8)}...)`);
    return { wrapTx };
  }

  /**
   * Manifest에서 보유 잔액 전액 인출 tx 생성 — fresh blockhash
   *
   * Manifest는 체결 수익을 Global account에 보관하므로,
   * globalWithdrawIx()로 base(SOL)와 quote(USDC) 잔액을 인출.
   * Global 모델은 wrapper 불필요 — 모든 토큰에 통합 적용.
   */
  async getWithdrawTx(
    userId: string,
    walletId: string,
  ): Promise<{ unsignedTx: string }> {
    this.logger.log(`[getWithdrawTx] START — user=${userId.slice(0, 8)} wallet=${walletId.slice(0, 8)}`);

    // 지갑 소유권 검증 + public key 획득
    const walletPublicKey = await this.verifyWalletOwnership(walletId, userId);
    const traderPubkey = new PublicKey(walletPublicKey);

    try {
      // Manifest SDK 동적 로드
      const { Market, ManifestClient } = await import('@cks-systems/manifest-sdk');

      // 등록된 모든 활성 토큰의 <토큰>/USDT 마켓을 순회하며 잔액이 있는 곳을 모두 인출한다.
      // ⚠️ 예전에는 SOL/USDT 마켓만 하드코딩 조회해서, 다른 토큰(DUDE 등) 거래로 생긴
      //    대금이 해당 마켓에 남아도 영영 인출되지 않고 묶이는 문제가 있었음.
      const { data: tokens } = await this.client
        .from('tokens')
        .select('symbol, mint_address')
        .eq('is_active', true);

      // 후보 base mint 목록 — 등록 토큰 + SOL(등록 안 돼 있어도 항상 포함)
      const baseMints = new Set<string>([NATIVE_MINT.toBase58()]);
      (tokens || []).forEach((t) => {
        const mint = t.mint_address as string;
        // USDT 자신은 base가 될 수 없음 (quote와 동일)
        if (mint && mint !== USDT_MINT) baseMints.add(mint);
      });

      const quoteMint = new PublicKey(USDT_MINT);
      const withdrawIxs = [];
      const wrapperKeypairs: Array<Parameters<typeof Transaction.prototype.partialSign>[0]> = [];
      const withdrawnFrom: string[] = [];

      // 트랜잭션 크기 한도가 있으므로 한 번에 인출할 마켓 수를 제한.
      // 초과분은 다음 인출에서 처리되며(잔액이 남아있으므로) 자금이 유실되지는 않음.
      const MAX_MARKETS_PER_TX = 3;

      for (const baseMintStr of baseMints) {
        if (withdrawnFrom.length >= MAX_MARKETS_PER_TX) {
          this.logger.warn(
            `[getWithdrawTx] market cap(${MAX_MARKETS_PER_TX}) reached — 남은 마켓은 다음 인출에서 처리됨`,
          );
          break;
        }

        try {
          const markets = await Market.findByMints(
            this.connection,
            new PublicKey(baseMintStr),
            quoteMint,
          );
          if (!markets || markets.length === 0) continue;

          const marketAddress = markets[0].address;

          // 잔액이 있는 마켓만 인출 대상에 포함
          const readOnlyClient = await ManifestClient.getClientReadOnly(
            this.connection,
            marketAddress,
            traderPubkey,
          );
          const baseBalance = readOnlyClient.market.getWithdrawableBalanceTokens(traderPubkey, true);
          const quoteBalance = readOnlyClient.market.getWithdrawableBalanceTokens(traderPubkey, false);
          if (baseBalance <= 0 && quoteBalance <= 0) continue;

          this.logger.log(
            `[getWithdrawTx] ${baseMintStr.slice(0, 8)}/USDT withdrawable — base=${baseBalance} quote=${quoteBalance}`,
          );

          const setupData = await ManifestClient.getSetupIxs(
            this.connection,
            marketAddress,
            traderPubkey,
          );
          if (setupData.setupNeeded) {
            withdrawIxs.push(...setupData.instructions);
            if (setupData.wrapperKeypair) wrapperKeypairs.push(setupData.wrapperKeypair);
          }

          const client = await ManifestClient.getClientForMarketNoPrivateKey(
            this.connection,
            marketAddress,
            traderPubkey,
          );
          withdrawIxs.push(...client.withdrawAllIx());
          withdrawnFrom.push(baseMintStr.slice(0, 8));
        } catch (err) {
          // 한 마켓 조회 실패가 전체 인출을 막지 않도록 — 나머지 마켓은 계속 시도
          this.logger.warn(
            `[getWithdrawTx] skip market ${baseMintStr.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (withdrawIxs.length === 0) {
        throw new BadRequestException('인출할 잔액이 없습니다.');
      }

      this.logger.log(
        `[getWithdrawTx] markets=[${withdrawnFrom.join(', ')}] total ixs=${withdrawIxs.length}`,
      );

      // fresh blockhash로 legacy transaction 빌드
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
      const withdrawTx = new Transaction({
        feePayer: traderPubkey,
        blockhash,
        lastValidBlockHeight,
      }).add(...withdrawIxs);

      // wrapper 생성 키페어가 있으면 서버에서 partial sign
      for (const kp of wrapperKeypairs) {
        withdrawTx.partialSign(kp);
      }
      if (wrapperKeypairs.length > 0) {
        this.logger.log(`[getWithdrawTx] ${wrapperKeypairs.length} wrapper keypair(s) pre-signed`);
      }

      const unsignedTx = withdrawTx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).toString('base64');

      this.logger.log(`[getWithdrawTx] DONE — wallet ${walletPublicKey.slice(0, 8)}...`);
      return { unsignedTx };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`[getWithdrawTx] error: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('인출 트랜잭션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  /**
   * 서명된 withdraw 트랜잭션 제출 — RPC 전송 후 컨펌 확인
   */
  async submitWithdrawTx(
    signedTx: string,
    _userId: string,
  ): Promise<{ txSignature: string }> {
    this.logger.log(`[submitWithdrawTx] START — txLen=${signedTx.length}`);
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
      this.logger.log(`[submitWithdrawTx] tx sent to RPC: ${txSignature.slice(0, 12)}...`);
    } catch (err) {
      this.logger.error(`[submitWithdrawTx] RPC error: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('인출 트랜잭션 제출에 실패했습니다.');
    }

    // 인출이 온체인에 반영되었는지 확인
    try {
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
      this.logger.log(`[submitWithdrawTx] waiting for confirm: ${txSignature.slice(0, 12)}...`);
      const confirmed = await this.connection.confirmTransaction(
        { signature: txSignature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      if (!confirmed.value || confirmed.value.err) {
        this.logger.warn(`[submitWithdrawTx] NOT CONFIRMED — tx=${txSignature} err=${JSON.stringify(confirmed.value?.err)}`);
        throw new BadRequestException('인출이 체인에 반영되지 않았습니다. 다시 시도해주세요.');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`[submitWithdrawTx] confirm timeout: ${txSignature} — ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('인출 컨펌이 지연되었습니다. 다시 시도해주세요.');
    }

    this.logger.log(`[submitWithdrawTx] CONFIRMED — tx=${txSignature.slice(0, 12)}...`);
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
    this.logger.log(`[submitOrder] START — order=${orderId} txLen=${signedTx.length}`);

    // 주문 소유자 + 상태 확인
    const { data: order, error: fetchError } = await this.client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !order) {
      this.logger.error(`[submitOrder] order not found: ${orderId}`);
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }

    if (order.status !== 'active') {
      this.logger.warn(`[submitOrder] invalid status: ${order.status} (order=${orderId})`);
      throw new BadRequestException('이미 처리되었거나 유효하지 않은 주문입니다.');
    }

    this.logger.log(`[submitOrder] order status=active, sending to RPC...`);

    // 전송 전 시뮬레이션 — tx가 왜 드롭되는지 원인 파악
    try {
      const simRes = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'simulateTransaction',
          params: [signedTx, {
            encoding: 'base64',
            sigVerify: true,
            commitment: 'confirmed',
            replaceRecentBlockhash: false,
          }],
        }),
      });
      const simData = await simRes.json() as {
        result?: {
          value?: {
            err?: unknown;
            logs?: string[];
            unitsConsumed?: number;
          };
        };
      };
      const sim = simData.result?.value;
      if (sim?.err) {
        this.logger.error(`[submitOrder] SIMULATION FAILED — err=${JSON.stringify(sim.err)}`);
        if (sim.logs?.length) {
          this.logger.error(`[submitOrder] SIM LOGS:\n${sim.logs.join('\n')}`);
        }
      } else {
        this.logger.log(`[submitOrder] simulation OK — units=${sim?.unitsConsumed}`);
      }
    } catch (simErr) {
      this.logger.warn(`[submitOrder] simulate error (non-fatal): ${simErr instanceof Error ? simErr.message : String(simErr)}`);
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
              skipPreflight: false,
              preflightCommitment: 'processed',
              maxRetries: 5,
            }],
          }),
        });

        const rpcData = await rpcRes.json() as { result?: string; error?: { message?: string; code?: number } };
        txSignature = rpcData.result || '';

        if (txSignature) {
          this.logger.log(`[submitOrder] RPC accepted: ${txSignature.slice(0, 12)}... (attempt ${attempt + 1})`);
          break; // 성공
        }

        lastError = rpcData.error?.message || 'RPC 전송 실패';
        this.logger.warn(`[submitOrder] RPC attempt ${attempt + 1} failed: code=${rpcData.error?.code} msg=${lastError}`);
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
      this.logger.log(`[submitOrder] waiting for confirm: ${txSignature.slice(0, 12)}...`);
      const confirmed = await connection.confirmTransaction(
        { signature: txSignature, blockhash, lastValidBlockHeight },
        'confirmed',
      );

      if (!confirmed.value || confirmed.value.err) {
        // 트랜잭션이 드롭되거나 실패 — DB에 기록하지 않고 에러 반환
        this.logger.warn(
          `[submitOrder] NOT CONFIRMED — tx=${txSignature} err=${JSON.stringify(confirmed.value?.err)}`,
        );
        throw new BadRequestException('트랜잭션이 체인에 반영되지 않았습니다. 다시 시도해주세요.');
      }
      this.logger.log(`[submitOrder] CONFIRMED — tx=${txSignature.slice(0, 12)}...`);
    } catch (err) {
      // TimeoutError(confirm 실패)도 포함
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`[submitOrder] confirm timeout: ${txSignature} — ${err instanceof Error ? err.message : String(err)}`);
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
      this.logger.error(`[submitOrder] DB update failed: ${updateError.message}`);
    }

    this.logger.log(`[submitOrder] DONE — order=${orderId} tx=${txSignature.slice(0, 12)}... status=submitted`);
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
    this.logger.log(`[getFreshOrderTx] START — order=${orderId}`);
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
    const quoteMint = USDT_MINT;
    const formattedSize = Number(order.quantity).toFixed(token.decimals);

    // 시장가일 때: 극단 가격으로 전체 호가 매칭 (매도=0.01, 매수=999999)
    let orderPrice = Number(order.price);
    if (order.order_type === 'market') {
      orderPrice = order.side === 'sell' ? 0.01 : 999999;
      this.logger.log(`[getFreshOrderTx] market ${order.side} — using extreme price: ${orderPrice}`);
    }
    const formattedPrice = orderPrice.toFixed(6);

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
            orderType: order.order_type === 'market' ? 'timeInForce' : 'limit',
            ...(order.order_type === 'market' ? { expirySlots: 150 } : {}),
            clientOrderId,
          },
        ],
        computeUnitPrice: MANIFEST.computeUnitPrice,
        setupIxs: true,
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

    this.logger.log(`[getFreshOrderTx] DONE — order=${orderId} txLen=${manifestData.transaction.length}`);
    return { unsignedTx: manifestData.transaction };
  }

  /**
   * 취소 서명 전 — Manifest에서 fresh blockhash의 unsigned cancel tx 재요청
   */
  async getFreshCancelTx(
    orderId: string,
    userId: string,
  ): Promise<{ unsignedTx?: string; cancelled?: boolean }> {
    const { data: order, error: fetchError } = await this.client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !order) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }

    // 이미 체결(filled)되었거나 완료된 주문 → 명확한 안내
    if (order.status === 'filled') {
      throw new BadRequestException('이미 체결된 주문입니다.');
    }
    if (['cancelled', 'expired', 'failed'].includes(order.status)) {
      throw new BadRequestException('이미 완료된 주문입니다.');
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
    const quoteMint = USDT_MINT;

    // Manifest DELETE 재호출 — 동일 파라미터로 fresh cancel tx 획득
    // setupIxs: true — wrapper setup ix를 cancel tx에 포함 (미체결 주문 취소 시 필수)
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
        setupIxs: true,
      }),
    });

    const cancelData = (await cancelRes.json()) as ManifestCancelResponse;

    if (!cancelRes.ok || !cancelData.transaction) {
      const errMsg = cancelData.error || '';
      const cause = cancelData.cause || '';
      this.logger.warn(
        `[cancelOrder] Manifest cancel-tx failed: ${cancelRes.status} — ${errMsg}: ${cause}`,
      );

      // 주문이 온체인에 없음 (이미 만료/드롭) → DB에서 삭제
      if (/not found|no such order|order not found|already/i.test(errMsg + ' ' + cause)) {
        this.logger.log(`[cancelOrder] order not on-chain, removing from DB: ${orderId}`);
        await this.client
          .from('orders')
          .delete()
          .eq('id', orderId);
        return { cancelled: true };
      }

      // 그 외 에러 (setup ixs, network 등) → 사용자에게 재시도 안내
      // Manifest가 알려준 구체적인 사유를 함께 노출 — 매번 같은 문구만 뜨면 원인 파악이 불가능해짐
      const detail = errMsg || cause;
      throw new BadRequestException(
        detail
          ? `취소 트랜잭션 생성에 실패했습니다: ${detail}`
          : '취소 트랜잭션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
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
          quoteMint: USDT_MINT, // 모든 페어 USDT 기준 (USDC 잔재 제거)
          orders: [
            sequenceNumber != null
              ? { sequenceNumber }
              : { clientOrderId: clientOrderId ?? 0 },
          ],
          computeUnitPrice: MANIFEST.computeUnitPrice,
          setupIxs: true,
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
        // 주문이 온체인에 없음 → expired 처리
        if (/not found|no such order|order not found|already/i.test(errMsg + ' ' + cause)) {
          await this.client
            .from('orders')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', order.id);
          throw new BadRequestException('이미 만료된 주문입니다.');
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
            skipPreflight: false,
            preflightCommitment: 'processed',
            maxRetries: 5,
          }],
        }),
      });

      const rpcData = await rpcRes.json() as { result?: string; error?: { message?: string; code?: number } };
      txSignature = rpcData.result || '';

      if (!txSignature) {
        throw new Error(rpcData.error?.message || 'RPC 전송 실패');
      }
      this.logger.log(`[submitCancelOrder] RPC accepted: ${txSignature.slice(0, 12)}...`);
    } catch (err) {
      this.logger.error(`[submitCancelOrder] RPC error: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('취소 트랜잭션 제출에 실패했습니다.');
    }

    // cancel tx on-chain confirm 대기
    const connection = new Connection(this.rpcUrl, {
      confirmTransactionInitialTimeout: 30_000,
    });
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      this.logger.log(`[submitCancelOrder] waiting for confirm: ${txSignature.slice(0, 12)}...`);
      const confirmed = await connection.confirmTransaction(
        { signature: txSignature, blockhash, lastValidBlockHeight },
        'confirmed',
      );

      if (!confirmed.value || confirmed.value.err) {
        this.logger.warn(`[submitCancelOrder] NOT CONFIRMED — tx=${txSignature} err=${JSON.stringify(confirmed.value?.err)}`);
        throw new BadRequestException('취소 트랜잭션이 체인에 반영되지 않았습니다. 다시 시도해주세요.');
      }
      this.logger.log(`[submitCancelOrder] CONFIRMED — tx=${txSignature.slice(0, 12)}...`);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`[submitCancelOrder] confirm timeout: ${txSignature} — ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('취소 컨펌 대기 시간 초과. 다시 시도해주세요.');
    }

    // DB 업데이트 — 'cancelled' 상태로.
    // ⚠️ tx_signature(주문 tx)는 덮어쓰지 않는다. 취소 tx는 별도 컬럼에 보관해
    //    "언제 주문했고 언제 취소했는지" 두 tx를 모두 추적할 수 있게 한다.
    const { error: updateError } = await this.client
      .from('orders')
      .update({
        cancel_tx_signature: txSignature,
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      // cancel_tx_signature 컬럼이 아직 없는 DB(마이그레이션 008 미적용) 대응 —
      // 상태만이라도 반영해 주문이 계속 활성으로 남지 않도록 한다
      if (/cancel_tx_signature|column/i.test(updateError.message)) {
        this.logger.warn('cancel_tx_signature column missing, updating status only');
        const { error: retryError } = await this.client
          .from('orders')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', orderId);
        if (retryError) {
          this.logger.error(`Failed to update cancelled order: ${retryError.message}`);
        }
      } else {
        this.logger.error(`Failed to update cancelled order: ${updateError.message}`);
      }
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
