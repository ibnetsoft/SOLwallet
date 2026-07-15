import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);
  private readonly rpcUrl: string;

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
   * 특정 지갑의 SOL 잔액 조회
   */
  async getSolBalance(walletAddress: string): Promise<number> {
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [walletAddress],
        }),
      });

      const data = await res.json() as { result?: { value?: number } };
      // lamports → SOL
      return (data.result?.value || 0) / 1e9;
    } catch (err) {
      this.logger.error(`Failed to get SOL balance: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }

  /**
   * 특정 지갑의 SPL 토큰 잔액 조회
   */
  async getTokenBalances(
    walletAddress: string,
  ): Promise<Array<{ mint: string; symbol: string; decimals: number; balance: number }>> {
    const { data: tokens } = await this.client
      .from('tokens')
      .select('*')
      .eq('is_active', true);

    if (!tokens || tokens.length === 0) return [];

    const balances: Array<{ mint: string; symbol: string; decimals: number; balance: number }> = [];

    for (const token of tokens) {
      try {
        const res = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenAccountsByOwner',
            params: [
              walletAddress,
              { mint: token.mint_address },
              { encoding: 'jsonParsed' },
            ],
          }),
        });

        const data = await res.json() as { result?: { value: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: number } } } } } }> } };
        const accounts = data.result?.value || [];

        if (accounts.length > 0) {
          const amount = Number(accounts[0].account?.data?.parsed?.info?.tokenAmount?.amount || 0);
          const decimals = token.decimals;
          balances.push({
            mint: token.mint_address,
            symbol: token.symbol,
            decimals,
            balance: amount / Math.pow(10, decimals),
          });
        }
      } catch {
        // 해당 토큰 잔액 조회 실패 시 스킵
      }
    }

    return balances;
  }

  /**
   * 전체 잔액 조회 (SOL + SPL 토큰)
   */
  async getFullBalance(walletAddress: string) {
    const solBalance = await this.getSolBalance(walletAddress);
    const tokenBalances = await this.getTokenBalances(walletAddress);

    return {
      walletAddress,
      sol: solBalance,
      tokens: tokenBalances,
      totalUsdtValue: 0, // TODO: 가격 API 연동 후 계산
    };
  }

  /**
   * 유저의 전체 포트폴리오 조회
   */
  async getPortfolio(userId: string) {
    const { data: wallets } = await this.client
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!wallets || wallets.length === 0) {
      return { wallets: [], totalUsdt: 0 };
    }

    const activeWallet = wallets[0];
    const balance = await this.getFullBalance(activeWallet.public_key);

    return {
      wallets: [{ publicKey: activeWallet.public_key, ...balance }],
      totalUsdt: balance.totalUsdtValue,
    };
  }
}
