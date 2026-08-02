import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ConfigService } from '@nestjs/config';
import { Connection } from '@solana/web3.js';

const JUPITER_BASE = 'https://lite-api.jup.ag/swap/v1';

/** Jupiter Quote API 응답 */
interface JupiterQuoteResponse {
  inputAmount?: string;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: number | string;
  otherAmountThreshold?: string;
  swapMode?: string;
  contextSlot?: number;
  timeTaken?: number;
  [key: string]: unknown;
}

/** Jupiter Swap API 응답 */
interface JupiterSwapResponse {
  swapTransaction?: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
}

export interface SwapQuoteResult {
  unsignedTx: string;
  quoteInfo: {
    inAmount: string;
    outAmount: string;
    outAmountThreshold: string;
    priceImpactPct: number;
  };
}

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);
  private readonly rpcUrl: string;
  private readonly connection: Connection;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') || '';
    this.connection = new Connection(this.rpcUrl, 'confirmed');
  }

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * walletId 소유권 검증 — 해당 지갑이 userId 소유인지 확인 후 public_key 반환
   */
  private async verifyWalletOwnership(
    walletId: string,
    userId: string,
  ): Promise<string> {
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
   * 스왑 견적 + unsigned 트랜잭션 획득 (Jupiter Swap API)
   *
   * 1. Jupiter Quote API로 경로/견적 조회
   * 2. Jupiter Swap API로 unsigned versioned tx 생성
   * 3. 클라이언트가 온디바이스 서명 → executeSwap()으로 제출
   *
   * @param walletId    사용자 지갑 ID (소유권 검증 + userPublicKey)
   * @param inputMint   보내는 토큰 mint
   * @param outputMint  받는 토큰 mint
   * @param amount      보내는 수량 (atomic units — 토큰 decimals 기준)
   * @param slippageBps 슬리피지 허용치 (bps, 기본 50 = 0.5%)
   */
  async getQuote(
    userId: string,
    walletId: string,
    inputMint: string,
    outputMint: string,
    amount: string,
    slippageBps = 50,
  ): Promise<SwapQuoteResult> {
    const userPublicKey = await this.verifyWalletOwnership(walletId, userId);

    if (inputMint === outputMint) {
      throw new BadRequestException('입출력 토큰이 동일합니다.');
    }
    if (!amount || amount === '0') {
      throw new BadRequestException('수량을 입력해주세요.');
    }

    // 1. Jupiter Quote API
    const quoteUrl =
      `${JUPITER_BASE}/quote?inputMint=${inputMint}` +
      `&outputMint=${outputMint}` +
      `&amount=${amount}` +
      `&slippageBps=${slippageBps}` +
      `&swapMode=ExactIn`;

    const quoteRes = await fetch(quoteUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!quoteRes.ok) {
      const errText = await quoteRes.text().catch(() => '');
      this.logger.error(`Jupiter quote failed: ${quoteRes.status} — ${errText}`);
      throw new BadRequestException(
        `견적 조회에 실패했습니다. (HTTP ${quoteRes.status})`,
      );
    }

    const quoteData = (await quoteRes.json()) as JupiterQuoteResponse;

    // 2. Jupiter Swap API — unsigned tx 생성
    const swapRes = await fetch(`${JUPITER_BASE}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey,
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: 'auto',
      }),
    });

    if (!swapRes.ok) {
      const errText = await swapRes.text().catch(() => '');
      this.logger.error(`Jupiter swap failed: ${swapRes.status} — ${errText}`);
      throw new BadRequestException(
        `스왑 트랜잭션 생성에 실패했습니다. (HTTP ${swapRes.status})`,
      );
    }

    const swapData = (await swapRes.json()) as JupiterSwapResponse;

    if (!swapData.swapTransaction) {
      throw new BadRequestException('스왑 트랜잭션을 생성하지 못했습니다.');
    }

    return {
      unsignedTx: swapData.swapTransaction,
      quoteInfo: {
        inAmount: String(quoteData.inAmount ?? quoteData.inputAmount ?? amount),
        outAmount: String(quoteData.outAmount ?? '0'),
        outAmountThreshold: String(quoteData.otherAmountThreshold ?? '0'),
        priceImpactPct:
          typeof quoteData.priceImpactPct === 'number'
            ? quoteData.priceImpactPct
            : Number(quoteData.priceImpactPct ?? 0),
      },
    };
  }

  /**
   * 서명된 스왑 트랜잭션을 Solana RPC에 제출
   * (orders.service.submitOrder와 동일한 RPC 호출 패턴)
   */
  async executeSwap(
    userId: string,
    signedTx: string,
  ): Promise<{ txSignature: string }> {
    if (!signedTx) {
      throw new BadRequestException('서명된 트랜잭션이 필요합니다.');
    }

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

      const rpcData = (await rpcRes.json()) as {
        result?: string;
        error?: { message?: string };
      };
      txSignature = rpcData.result || '';

      if (!txSignature) {
        throw new Error(rpcData.error?.message || 'RPC 전송 실패');
      }
    } catch (err) {
      this.logger.error(
        `RPC submit error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(
        '트랜잭션 전송에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
    }

    this.logger.log(`Swap submitted by user ${userId}: ${txSignature}`);

    // sendTransaction은 네트워크에 전달만 할 뿐 실제로 블록에 포함됐는지 보장하지
    // 않는다 — 이 확인 없이 그대로 성공 응답하면, 블록해시 만료 등으로 트랜잭션이
    // 조용히 드랍돼도 클라이언트는 "성공" 토스트를 보고 잔액은 안 바뀌는 상황이 됨
    // (0.0002 USDT → USDC 스왑에서 실측 재현 — getSignatureStatuses가 계속 null).
    try {
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
      const confirmed = await this.connection.confirmTransaction(
        { signature: txSignature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      if (!confirmed.value || confirmed.value.err) {
        this.logger.warn(`Swap NOT CONFIRMED — tx=${txSignature} err=${JSON.stringify(confirmed.value?.err)}`);
        throw new BadRequestException('스왑이 체인에 반영되지 않았습니다. 다시 시도해주세요.');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`Swap confirm timeout: ${txSignature} — ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('스왑 컨펌이 지연되었습니다. 잠시 후 잔액을 확인해주세요.');
    }

    this.logger.log(`Swap CONFIRMED — tx=${txSignature.slice(0, 12)}...`);
    return { txSignature };
  }
}
