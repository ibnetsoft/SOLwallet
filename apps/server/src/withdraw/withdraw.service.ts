import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class WithdrawService {
  private readonly logger = new Logger(WithdrawService.name);
  private readonly rpcUrl: string;
  private readonly solMint = 'So11111111111111111111111111111111111111112';

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {
    this.rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') || '';
  }

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * 출금 — 클라이언트가 서명한 트랜잭션을 RPC로 전송
   * 클라이언트: 지갑 잠금 해제 → transfer 트랜잭션 빌드 → 서명 → 서버에 전송
   */
  async submitWithdraw(
    userId: string,
    params: {
      walletId: string;
      toAddress: string;
      mint: string;
      amount: number;
      signedTx: string;
    },
  ): Promise<{ txSignature: string }> {
    const { walletId, toAddress, mint, amount, signedTx } = params;
    // 지갑 소유권 검증
    const { data: wallet, error: walletErr } = await this.client
      .from('wallets')
      .select('id, public_key')
      .eq('id', walletId)
      .eq('user_id', userId)
      .single();

    if (walletErr || !wallet) {
      throw new BadRequestException('유효하지 않거나 소유하지 않은 지갑입니다.');
    }

    // 잔액 확인 (간이 검증 — 실제 잔액 체크는 온체인에서)
    const isSol = mint === this.solMint;
    try {
      if (isSol) {
        // SOL 잔액
        const res = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [wallet.public_key],
          }),
        });
        const data = await res.json() as { result?: { value?: number } };
        const balance = (data.result?.value || 0) / 1e9;
        if (balance < amount) {
          throw new BadRequestException(`잔액 부족 — 보유: ${balance.toFixed(6)} SOL`);
        }
      } else {
        // SPL 토큰 잔액
        const res = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenAccountsByOwner',
            params: [
              wallet.public_key,
              { mint: mint },
              { encoding: 'jsonParsed' },
            ],
          }),
        });
        const data = await res.json() as {
          result?: { value: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }> }
        };
        const accounts = data.result?.value || [];
        if (accounts.length === 0) {
          throw new BadRequestException('해당 토큰을 보유하고 있지 않습니다.');
        }
        const rawAmount = Number(accounts[0].account?.data?.parsed?.info?.tokenAmount?.amount || 0);
        if (rawAmount < amount * 1e9) {
          throw new BadRequestException('토큰 잔액이 부족합니다.');
        }
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`Balance check failed: ${err instanceof Error ? err.message : String(err)}`);
      // 잔액 검증 실패해도 일단 시도 (서명 트랜잭션을 클라이언트가 만들었으므로)
    }

    // 트랜잭션 RPC 전송
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
      this.logger.error(`Withdraw RPC error: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('출금 트랜잭션 전송에 실패했습니다.');
    }

    this.logger.log(`Withdraw successful: ${txSignature.slice(0, 12)}... (${amount} ${isSol ? 'SOL' : 'token'})`);

    return { txSignature };
  }
}
