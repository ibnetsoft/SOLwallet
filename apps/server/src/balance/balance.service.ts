import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { PriceService } from '../price/price.service';
import { TransfersService } from '../transfers/transfers.service';
import { WSOL_MINT } from '@solwallet/config';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);
  private readonly rpcUrl: string;

  /** SOL 잔고 캐시 — RPC 장애 시 마지막 성공값 반환용 */
  private readonly solBalanceCache = new Map<string, { balance: number; ts: number }>();
  private readonly SOL_BALANCE_TTL_MS = 60_000;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly priceService: PriceService,
    private readonly transfersService: TransfersService,
  ) {
    this.rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') || '';
  }

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * RPC 호출 헬퍼 — 1회 재시도 로직 (AdminService.rpc 패턴과 동일)
   *
   * 순간적인 RPC 장애(레이트 리밋, 타임아웃 등)가 잔고 0으로 전락하는 것을
   * 방지하기 위해 즉시 1번 재시도하여 일시적 실패를 흡수한다.
   */
  private async rpc<T>(method: string, params: unknown[], _retried = false): Promise<T | null> {
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const json = (await res.json()) as { result?: T; error?: { message?: string } };
      if (json.error) {
        if (!_retried) {
          await new Promise((r) => setTimeout(r, 300));
          return this.rpc<T>(method, params, true);
        }
        this.logger.warn(`RPC ${method} error: ${json.error.message}`);
        return null;
      }
      return json.result ?? null;
    } catch (err) {
      if (!_retried) {
        await new Promise((r) => setTimeout(r, 300));
        return this.rpc<T>(method, params, true);
      }
      this.logger.warn(`RPC ${method} failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * 특정 지갑의 SOL 잔액 조회 — 재시도 + 캐시 폴백
   */
  async getSolBalance(walletAddress: string): Promise<number> {
    const result = await this.rpc<{ value?: number }>('getBalance', [walletAddress]);

    if (result === null) {
      // RPC 전체 실패 시 마지막 성공 캐시 반환
      const cached = this.solBalanceCache.get(walletAddress);
      if (cached && Date.now() - cached.ts < this.SOL_BALANCE_TTL_MS) {
        this.logger.warn(`SOL balance RPC failed for ${walletAddress.slice(0, 8)}... — using cached value`);
        return cached.balance;
      }
      this.logger.error(`SOL balance RPC failed and no cache for ${walletAddress.slice(0, 8)}...`);
      return 0;
    }

    const balance = (result.value || 0) / 1e9;
    this.solBalanceCache.set(walletAddress, { balance, ts: Date.now() });
    return balance;
  }

  /**
   * 특정 지갑의 SPL 토큰 잔액 조회 — 재시도 + Supabase 에러 체크
   */
  async getTokenBalances(
    walletAddress: string,
  ): Promise<Array<{ mint: string; symbol: string; decimals: number; balance: number; usdValue: number; logoUrl?: string }>> {
    const { data: tokens, error: tokenErr } = await this.client
      .from('tokens')
      .select('*')
      .eq('is_active', true);

    if (tokenErr) {
      this.logger.error(`Supabase tokens query failed: ${tokenErr.message}`);
      return [];
    }
    if (!tokens || tokens.length === 0) return [];

    const balances: Array<{ mint: string; symbol: string; decimals: number; balance: number; usdValue: number; logoUrl?: string }> = [];

    for (const token of tokens) {
      try {
        const data = await this.rpc<{
          value: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }>
        }>('getTokenAccountsByOwner', [walletAddress, { mint: token.mint_address }, { encoding: 'jsonParsed' }]);

        const accounts = data?.value || [];

        if (accounts.length > 0) {
          const amount = Number(accounts[0].account?.data?.parsed?.info?.tokenAmount?.amount || 0);
          const decimals = token.decimals;
          const balance = amount / Math.pow(10, decimals);

          // 스테이블코인은 1:1 고정, 그 외는 Manifest <mint>/USDT 오더북 중간가
          const symbolUpper = (token.symbol as string).toUpperCase();
          const isStable = symbolUpper === 'USDT' || symbolUpper === 'USDC';
          const price = isStable ? 1 : await this.priceService.getTokenPrice(token.mint_address);

          balances.push({
            mint: token.mint_address,
            symbol: token.symbol,
            decimals,
            balance,
            usdValue: balance * price,
            logoUrl: this.getTokenLogoUrl(token.symbol),
          });
        }
      } catch (err) {
        this.logger.warn(
          `Token balance fetch failed for ${token.symbol}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return balances;
  }

  /**
   * 토큰 로고 public URL 생성 (파일명 규칙)
   * token-logos/{symbol-lowercase}.png
   */
  private getTokenLogoUrl(symbol: string): string {
    const BUCKET = 'token-logos';
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${symbol.toLowerCase()}.png`;
  }

  /**
   * 전체 잔액 조회 (SOL + SPL 토큰)
   */
  async getFullBalance(walletAddress: string) {
    const [solBalance, tokenBalances] = await Promise.all([
      this.getSolBalance(walletAddress),
      this.getTokenBalances(walletAddress),
    ]);

    // SOL은 프론트에서 별도 시세(/api/price/sol)로 합산하므로 여기선 SPL 토큰 가치만 더함
    const totalUsdtValue = tokenBalances.reduce((sum, t) => sum + t.usdValue, 0);

    return {
      walletAddress,
      sol: solBalance,
      tokens: tokenBalances,
      totalUsdtValue,
    };
  }

  /**
   * ROI 초기값(baseline) 확보 — 지갑에 각 코인이 "최초로" 들어왔을 때의 달러 가치를
   * 코인별로 wallet_deposit_baseline에 기록해두고, 그 합계를 반환한다.
   *
   * 이미 기록된 코인은 다시 스캔하지 않는다(가격이 매번 바뀌면 "초기값"이라는
   * 의미가 없어지므로 최초 감지 시점 값으로 고정). 현재 잔액이 있는데 아직
   * 기록이 없는 코인만 온체인 입금 이력을 스캔해 새로 채워 넣는다.
   * 온체인에서 입금 증거를 못 찾으면(거래로 취득한 경우 등) 현재 잔액을
   * "최초 수량"으로 근사한다 — 과거 시세 이력이 없는 것과 같은 종류의 근사.
   */
  private async ensureDepositBaseline(
    walletId: string,
    walletAddress: string,
    solBalance: number,
    tokenBalances: Array<{ mint: string; symbol: string; balance: number; usdValue: number }>,
  ): Promise<number> {
    const { data: existing } = await this.client
      .from('wallet_deposit_baseline')
      .select('mint_address, usd_value_at_deposit')
      .eq('wallet_id', walletId);

    const covered = new Set((existing ?? []).map((r) => r.mint_address as string));
    let sum = (existing ?? []).reduce((s, r) => s + Number(r.usd_value_at_deposit), 0);

    const missing: Array<{ mint: string; symbol: string; balance: number; usdValue: number }> = [];
    if (solBalance > 0 && !covered.has(WSOL_MINT)) {
      missing.push({ mint: WSOL_MINT, symbol: 'SOL', balance: solBalance, usdValue: 0 });
    }
    for (const t of tokenBalances) {
      if (t.balance > 0 && !covered.has(t.mint)) missing.push(t);
    }
    if (missing.length === 0) return sum;

    let firstDeposits: Map<string, { amount: number; blockTime: number }>;
    try {
      firstDeposits = await this.transfersService.findFirstDeposits(walletAddress);
    } catch (err) {
      this.logger.warn(
        `findFirstDeposits failed for ${walletAddress.slice(0, 8)}...: ${err instanceof Error ? err.message : String(err)}`,
      );
      firstDeposits = new Map();
    }

    let solPrice = 0;
    if (missing.some((m) => m.mint === WSOL_MINT)) {
      try {
        solPrice = (await this.priceService.getSolPrice()).price;
      } catch {
        solPrice = 0;
      }
    }

    const rows: Array<{ wallet_id: string; mint_address: string; symbol: string; first_amount: number; usd_value_at_deposit: number }> = [];
    for (const m of missing) {
      const amount = firstDeposits.get(m.mint)?.amount ?? m.balance;
      const price = m.mint === WSOL_MINT ? solPrice : m.balance > 0 ? m.usdValue / m.balance : 0;
      const usdValue = amount * price;
      rows.push({
        wallet_id: walletId,
        mint_address: m.mint,
        symbol: m.symbol,
        first_amount: amount,
        usd_value_at_deposit: usdValue,
      });
      sum += usdValue;
    }

    const { error } = await this.client
      .from('wallet_deposit_baseline')
      .upsert(rows, { onConflict: 'wallet_id,mint_address', ignoreDuplicates: true });
    if (error) {
      this.logger.warn(`Failed to persist deposit baseline: ${error.message}`);
    }

    return sum;
  }

  /**
   * 외부로 나간 출금 누적액(USD 환산) — ROI에서 제외하기 위함.
   * Manifest 잔액 인출("수익 인출")은 자산이 지갑 안에 그대로 남으므로 여기 포함되지 않고,
   * 다른 주소로 실제로 보낸 출금(WithdrawModal, transfers 테이블)만 집계한다.
   */
  private async getWithdrawnTotal(walletId: string): Promise<number> {
    const { data: withdrawals } = await this.client
      .from('transfers')
      .select('amount, token_symbol, token_mint')
      .eq('wallet_id', walletId)
      .eq('type', 'withdraw')
      .eq('status', 'completed');

    if (!withdrawals || withdrawals.length === 0) return 0;

    let total = 0;
    for (const w of withdrawals) {
      const symbolUpper = (w.token_symbol as string).toUpperCase();
      let price: number;
      if (symbolUpper === 'USDT' || symbolUpper === 'USDC') price = 1;
      else if (symbolUpper === 'SOL') {
        try {
          price = (await this.priceService.getSolPrice()).price;
        } catch {
          price = 0;
        }
      } else {
        price = await this.priceService.getTokenPrice(w.token_mint as string);
      }
      total += Number(w.amount) * price;
    }
    return total;
  }

  /**
   * 유저의 전체 포트폴리오 조회 — 모든 활성 지갑 포함
   */
  async getPortfolio(userId: string) {
    const { data: wallets, error: walletErr } = await this.client
      .from('wallets')
      .select('id, public_key')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (walletErr) {
      this.logger.error(`Supabase wallets query failed for user ${userId}: ${walletErr.message}`);
      return { wallets: [], totalUsdt: 0, roiBaseline: 0, withdrawnTotal: 0 };
    }
    if (!wallets || wallets.length === 0) {
      return { wallets: [], totalUsdt: 0, roiBaseline: 0, withdrawnTotal: 0 };
    }

    // 활성 지갑의 잔액 조회
    const walletBalances = await Promise.all(
      wallets.map(async (w) => {
        const balance = await this.getFullBalance(w.public_key);
        const [roiBaseline, withdrawnTotal] = await Promise.all([
          this.ensureDepositBaseline(w.id, w.public_key, balance.sol, balance.tokens),
          this.getWithdrawnTotal(w.id),
        ]);
        return { publicKey: w.public_key, ...balance, roiBaseline, withdrawnTotal };
      }),
    );

    const totalUsdt = walletBalances.reduce((sum, wb) => sum + wb.totalUsdtValue, 0);
    const roiBaseline = walletBalances.reduce((sum, wb) => sum + wb.roiBaseline, 0);
    const withdrawnTotal = walletBalances.reduce((sum, wb) => sum + wb.withdrawnTotal, 0);

    return {
      wallets: walletBalances,
      totalUsdt,
      roiBaseline,
      withdrawnTotal,
    };
  }
}
