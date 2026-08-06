import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { TransfersService } from '../transfers/transfers.service';
import { PriceService } from '../price/price.service';
import type {
  AdminStats,
  AdminDashboard,
  DashboardTodayUser,
  DashboardTodayOrder,
  DashboardTodayTransfer,
} from '@solwallet/shared-types';

const SOL_MINT_ADDR = 'So11111111111111111111111111111111111111112';
const USDT_MINT_ADDR = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const USDC_MINT_ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/** 스테이블코인 — USDT 환산 시 1:1로 계산 */
const STABLE_MINTS = new Set([USDT_MINT_ADDR, USDC_MINT_ADDR]);

/**
 * "오늘"의 시작 시각(KST 00:00)을 UTC Date로 반환.
 *
 * `new Date(); .setHours(0,0,0,0)`는 컨테이너의 시스템 타임존(EC2 Docker는 보통
 * UTC) 기준 자정을 계산한다 — KST는 UTC+9라 실제로는 한국 시간 오전 9시가
 * "오늘 시작"으로 잡혀, 오전 9시 이전 활동(가입/거래/입금)이 전부 "어제"로
 * 빠지는 버그가 있었다. 대시보드의 오늘 가입·오늘 트랜잭션·오늘 입금액이
 * 전부 이 함수를 거치지 않은 계산을 썼던 게 원인.
 */
function getKstTodayStart(): Date {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstWallClock = new Date(Date.now() + KST_OFFSET_MS);
  kstWallClock.setUTCHours(0, 0, 0, 0);
  return new Date(kstWallClock.getTime() - KST_OFFSET_MS);
}

// 내부 트리 노드 타입 (buildTree/getReferralTree에서 사용)
export interface TreeNodeShape {
  id: string;
  username: string | null;
  firstName: string;
  telegramUid: number;
  referralCode: string | null;
  depth: number;
  createdAt: string;
  childrenCount: number;
  children: TreeNodeShape[];
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly transfersService: TransfersService,
    private readonly priceService: PriceService,
  ) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  private get rpcUrl(): string {
    return this.configService.get<string>('SOLANA_RPC_URL') || '';
  }

  /**
   * 대시보드 입금 집계 캐시 — 온체인 RPC 호출이 무거워 60초간 재사용.
   * (지갑 수 × RPC 호출이라 매 새로고침마다 조회하면 rate limit에 걸림)
   */
  private depositStatsCache: {
    at: number;
    data: { totalDepositUsdt: number; pureUsdtBalance: number; todayDepositUsdt: number; todayWithdrawalUsdt: number; partial: boolean };
  } | null = null;
  private readonly DEPOSIT_CACHE_MS = 60_000;

  /**
   * RPC JSON-RPC 호출 헬퍼 — 1회 재시도 포함.
   *
   * 오늘의 입금액 집계는 지갑 수 × (서명조회 + 트랜잭션조회) 만큼 순차 RPC
   * 호출을 하는데, 그중 단 하나만 일시적으로 실패해도 그 지갑분이 통째로
   * 누락돼 총액이 들쭉날쭉해지는 원인이었다(새로고침마다 0원↔정상 금액을
   * 오갔음). 즉시 1번 재시도해서 순간적인 실패를 흡수한다.
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

  /** SOL 현재가(USD) — Jupiter Price API. 실패 시 0 (SOL은 환산에서 제외됨) */
  private async getSolPriceUsd(): Promise<number> {
    try {
      const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT_ADDR}`);
      if (!res.ok) return 0;
      const data = (await res.json()) as Record<string, { usdPrice?: number }>;
      return Number(data?.[SOL_MINT_ADDR]?.usdPrice) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * 대시보드 통계 조회
   */
  async getStats(): Promise<AdminStats> {
    // 총 유저 수
    const { count: totalUsers } = await this.client
      .from('users')
      .select('*', { count: 'exact', head: true });

    // 오늘 신규 가입 (KST 자정 기준)
    const { count: todaySignups } = await this.client
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', getKstTodayStart().toISOString());

    // 총 수수료 수익 (체결 완료된 주문만 — 실제 발생한 수익)
    const { data: feeData } = await this.client
      .from('orders')
      .select('fee')
      .eq('status', 'filled');

    const totalFeeRevenue = (feeData || []).reduce(
      (sum, o) => sum + Number(o.fee || 0),
      0,
    );

    // 총 주문 / 활성 주문
    const { count: totalOrders } = await this.client
      .from('orders')
      .select('*', { count: 'exact', head: true });

    const { count: activeOrders } = await this.client
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .in('status', ['active', 'submitted']);

    return {
      totalUsers: totalUsers || 0,
      todaySignups: todaySignups || 0,
      totalFeeRevenue: Math.round(totalFeeRevenue * 1e6) / 1e6,
      totalOrders: totalOrders || 0,
      activeOrders: activeOrders || 0,
    };
  }

  /**
   * 대시보드 전체 데이터 — 기존 통계 + 입금 현황 + 오늘의 가입/트랜잭션 목록
   */
  async getDashboard(nocache = false): Promise<AdminDashboard> {
    const todayStart = getKstTodayStart();
    const todayIso = todayStart.toISOString();

    const [stats, deposit, todayUsers, todayOrders, todayTransfers] = await Promise.all([
      this.getStats(),
      this.getDepositStats(todayStart, nocache),
      this.getTodayUsers(todayIso),
      this.getTodayOrders(todayIso),
      this.getTodayTransfers(todayIso),
    ]);

    return {
      ...stats,
      totalDepositUsdt: deposit.totalDepositUsdt,
      pureUsdtBalance: deposit.pureUsdtBalance,
      todayDepositUsdt: deposit.todayDepositUsdt,
      todayWithdrawalUsdt: deposit.todayWithdrawalUsdt,
      depositStatsPartial: deposit.partial,
      todayUsers,
      todayOrders,
      todayTransfers,
    };
  }

  /** 오늘 가입한 회원 목록 (스폰서 Tele ID 포함) */
  private async getTodayUsers(todayIso: string): Promise<DashboardTodayUser[]> {
    const { data } = await this.client
      .from('users')
      .select('*')
      .gte('created_at', todayIso)
      .order('created_at', { ascending: false });

    const rows = data || [];
    if (rows.length === 0) return [];

    // 스폰서 표시용 — referred_by → username/first_name/telegram_uid
    const referrerIds = Array.from(new Set(rows.map((u) => u.referred_by).filter(Boolean)));
    const referrerMap: Record<string, string> = {};
    if (referrerIds.length > 0) {
      const { data: referrers } = await this.client
        .from('users')
        .select('id, username, first_name, telegram_uid')
        .in('id', referrerIds);
      (referrers || []).forEach((r) => {
        referrerMap[r.id as string] =
          (r.username as string) || (r.first_name as string) || String(r.telegram_uid);
      });
    }

    return rows.map((u) => ({
      id: u.id,
      telegramUid: u.telegram_uid,
      username: u.username,
      firstName: u.first_name,
      createdAt: u.created_at,
      referralCode: u.referral_code ?? null,
      sponsorTeleId: u.referred_by ? referrerMap[u.referred_by] ?? null : null,
      adminNickname: u.admin_nickname ?? null,
    }));
  }

  /** 오늘 발생한 주문(트랜잭션) 목록 */
  private async getTodayOrders(todayIso: string): Promise<DashboardTodayOrder[]> {
    const { data } = await this.client
      .from('orders')
      .select('*, users(username, first_name, telegram_uid), tokens(symbol)')
      .gte('created_at', todayIso)
      .order('created_at', { ascending: false })
      .limit(100);

    return (data || []).map((o) => {
      const u = o.users as { username?: string; first_name?: string; telegram_uid?: number } | null;
      const t = o.tokens as { symbol?: string } | null;
      return {
        id: o.id,
        createdAt: o.created_at,
        username: u?.username || u?.first_name || String(u?.telegram_uid ?? '—'),
        side: o.side,
        tokenSymbol: t?.symbol || '—',
        price: o.price,
        quantity: o.quantity,
        fee: o.fee,
        status: o.status,
        txSignature: o.tx_signature ?? null,
      };
    });
  }

  /**
   * 오늘의 입출금 내역 — 활성 지갑 전체를 온체인에서 실시간 스캔(트랜잭션
   * 페이지의 getAllTransfers와 동일 로직)해 KST 오늘 자정 이후 항목만 추림.
   */
  private async getTodayTransfers(todayIso: string): Promise<DashboardTodayTransfer[]> {
    try {
      return await this.transfersService.getAllTransfers(20, todayIso);
    } catch (err) {
      this.logger.warn(`[getTodayTransfers] 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * 입금 현황 집계 — 전체 보유 잔고 + 오늘 입금액 (모두 USDT 환산)
   *
   * transfers 테이블에는 출금만 기록되고 입금은 남지 않으므로 온체인에서 직접 집계한다.
   * RPC 호출을 최소화하기 위해:
   *  - SOL 잔고: getMultipleAccounts로 최대 100개 지갑을 한 번에 조회
   *  - SPL 잔고: 지갑당 getTokenAccountsByOwner 1회 (모든 민트를 한 번에)
   *  - 오늘 입금: getSignaturesForAddress로 먼저 오늘 것만 추린 뒤 해당 tx만 상세 조회
   */
  private async getDepositStats(
    todayStart: Date,
    nocache = false,
  ): Promise<{ totalDepositUsdt: number; pureUsdtBalance: number; todayDepositUsdt: number; todayWithdrawalUsdt: number; partial: boolean }> {
    const cached = this.depositStatsCache;
    if (!nocache && cached && Date.now() - cached.at < this.DEPOSIT_CACHE_MS) {
      return cached.data;
    }

    const empty = { totalDepositUsdt: 0, pureUsdtBalance: 0, todayDepositUsdt: 0, todayWithdrawalUsdt: 0, partial: true };
    if (!this.rpcUrl) return empty;

    const { data: wallets } = await this.client.from('wallets').select('public_key');
    const addresses = (wallets || []).map((w) => w.public_key as string).filter(Boolean);
    if (addresses.length === 0) {
      const zero = { totalDepositUsdt: 0, pureUsdtBalance: 0, todayDepositUsdt: 0, todayWithdrawalUsdt: 0, partial: false };
      this.depositStatsCache = { at: Date.now(), data: zero };
      return zero;
    }

    const solPrice = await this.getSolPriceUsd();
    let partial = solPrice === 0; // SOL 시세를 못 받으면 SOL분이 빠지므로 부분 집계

    // ── 1. 전체 보유 잔고 ──
    let totalDepositUsdt = 0;
    let pureUsdtBalance = 0; // USDT + USDC만 (1:1)

    // SOL: getMultipleAccounts (100개씩)
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const res = await this.rpc<{ value: Array<{ lamports?: number } | null> }>(
        'getMultipleAccounts',
        [chunk, { encoding: 'jsonParsed' }],
      );
      if (!res) {
        partial = true;
        continue;
      }
      (res.value || []).forEach((acc) => {
        const lamports = acc?.lamports ?? 0;
        totalDepositUsdt += (lamports / 1e9) * solPrice;
      });
    }

    // SPL 토큰: 지갑당 1회
    for (const addr of addresses) {
      const res = await this.rpc<{
        value: Array<{
          account?: {
            data?: {
              parsed?: {
                info?: { mint?: string; tokenAmount?: { uiAmount?: number } };
              };
            };
          };
        }>;
      }>('getTokenAccountsByOwner', [
        addr,
        { programId: TOKEN_PROGRAM_ID },
        { encoding: 'jsonParsed' },
      ]);
      if (!res) {
        partial = true;
        continue;
      }
      for (const acc of (res.value || [])) {
        const info = acc.account?.data?.parsed?.info;
        const mint = info?.mint;
        const uiAmount = Number(info?.tokenAmount?.uiAmount ?? 0);
        if (!mint || !uiAmount) continue;
        totalDepositUsdt += await this.toUsdt(mint, uiAmount, solPrice);
        // 순수 USDT+USDC 잔고 (스테이블코인만 1:1 누적)
        if (STABLE_MINTS.has(mint)) pureUsdtBalance += uiAmount;
      }
    }

    // ── 2. 오늘 입금액 + 오늘 출금액 ──
    const { todayDepositUsdt, todayWithdrawalUsdt } = await this.sumTodayFlows(addresses, todayStart, solPrice, () => {
      partial = true;
    });

    const result = {
      totalDepositUsdt: Math.round(totalDepositUsdt * 1e6) / 1e6,
      pureUsdtBalance: Math.round(pureUsdtBalance * 1e6) / 1e6,
      todayDepositUsdt: Math.round(todayDepositUsdt * 1e6) / 1e6,
      todayWithdrawalUsdt: Math.round(todayWithdrawalUsdt * 1e6) / 1e6,
      partial,
    };

    // 이번 집계가 일부 RPC 실패로 불완전한데, 직전에 이미 완전히 성공한 값이
    // 있다면 그걸 유지한다 — 재시도까지 다 실패한 극히 일부 경우에 화면이
    // 정상 금액 → 0(또는 더 작은 값) → 다시 정상으로 깜빡이는 걸 막기 위함.
    if (partial && cached && !cached.data.partial) {
      this.logger.warn('[getDepositStats] 이번 집계 partial — 직전 성공 캐시 유지');
      return cached.data;
    }
    // partial인데 이전 성공 캐시도 없으면 결과를 캐시하지 않음 —
    // 다음 요청에서 다시 계산시켜 정상값을 얻을 기회를 준다.
    // (서버 재시작 직후 첫 요청이 partial인 경우 $0.00이 60초간 고정되는 버그 방지)
    if (partial) {
      this.logger.warn('[getDepositStats] 이번 집계 partial — 캐시하지 않음 (재시도 대기)');
      return result;
    }

    this.depositStatsCache = { at: Date.now(), data: result };
    return result;
  }

  /** 민트별 USDT 환산 — 스테이블 1:1, SOL/wSOL은 시세 적용, 그 외는 최근 체결가 기준 */
  private async toUsdt(mint: string, uiAmount: number, solPrice: number): Promise<number> {
    if (STABLE_MINTS.has(mint)) return uiAmount;
    if (mint === SOL_MINT_ADDR) return uiAmount * solPrice;
    // 그 외 토큰 — PriceService에서 최근 체결가(USDT) 조회
    try {
      const price = await this.priceService.getTokenPrice(mint);
      if (price > 0) return uiAmount * price;
    } catch {
      // 가격 조회 실패 시 0 (부분 집계는 아님 — 이 토큰 종류만 누락)
    }
    return 0;
  }

  /**
   * 오늘 각 지갑의 입금/출금액 합계 (USDT 환산)
   * 서명 목록에서 blockTime으로 먼저 오늘 것만 추려 상세 조회를 최소화한다.
   * 같은 트랜잭션에서 diff > 0이면 입금, diff < 0이면 출금으로 각각 누적.
   */
  private async sumTodayFlows(
    addresses: string[],
    todayStart: Date,
    solPrice: number,
    markPartial: () => void,
  ): Promise<{ todayDepositUsdt: number; todayWithdrawalUsdt: number }> {
    const todaySec = Math.floor(todayStart.getTime() / 1000);
    let todayDepositUsdt = 0;
    let todayWithdrawalUsdt = 0;

    for (const addr of addresses) {
      const sigs = await this.rpc<Array<{ signature: string; blockTime?: number | null; err?: unknown }>>(
        'getSignaturesForAddress',
        [addr, { limit: 25 }],
      );
      if (!sigs) {
        markPartial();
        continue;
      }

      const todaySigs = sigs
        .filter((s) => !s.err && typeof s.blockTime === 'number' && (s.blockTime as number) >= todaySec)
        .map((s) => s.signature);

      for (const sig of todaySigs) {
        const tx = await this.rpc<{
          meta?: {
            err?: unknown;
            preBalances?: number[];
            postBalances?: number[];
            preTokenBalances?: Array<{ owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number } }>;
            postTokenBalances?: Array<{ owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number } }>;
          } | null;
          transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string }> } };
        }>('getTransaction', [sig, { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }]);

        if (!tx?.meta || tx.meta.err) continue;

        // SOL 증감분
        const keys = (tx.transaction?.message?.accountKeys || []).map((k) =>
          typeof k === 'string' ? k : k?.pubkey || '',
        );
        const idx = keys.indexOf(addr);
        if (idx >= 0 && tx.meta.preBalances && tx.meta.postBalances) {
          const diff = (tx.meta.postBalances[idx] ?? 0) - (tx.meta.preBalances[idx] ?? 0);
          if (diff > 0) todayDepositUsdt += (diff / 1e9) * solPrice;
          else if (diff < 0) todayWithdrawalUsdt += (Math.abs(diff) / 1e9) * solPrice;
        }

        // SPL 토큰 증감분 (이 지갑이 owner인 계정만)
        const pre = tx.meta.preTokenBalances || [];
        const post = tx.meta.postTokenBalances || [];
        for (const p of post) {
          if (p.owner !== addr || !p.mint) continue;
          const before = pre.find((b) => b.owner === addr && b.mint === p.mint);
          const diff =
            Number(p.uiTokenAmount?.uiAmount ?? 0) - Number(before?.uiTokenAmount?.uiAmount ?? 0);
          if (diff > 0) todayDepositUsdt += await this.toUsdt(p.mint, diff, solPrice);
          else if (diff < 0) todayWithdrawalUsdt += await this.toUsdt(p.mint, Math.abs(diff), solPrice);
        }
      }
    }

    return { todayDepositUsdt, todayWithdrawalUsdt };
  }

  /**
   * 유저 목록 (페이지네이션) — walletCount 실제 계산
   */
  async getUsers(page = 1, pageSize = 20) {
    // pageSize 상한선 (DoS 방지)
    const safePageSize = Math.min(pageSize, 100);
    const from = (page - 1) * safePageSize;
    const to = from + safePageSize - 1;

    const { data, count } = await this.client
      .from('users')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // 각 유저의 지갑 수 등 부가 정보 조회 (배치)
    const userIds = (data || []).map((u) => u.id);
    const walletCounts: Record<string, number> = {};
    const referrerMap: Record<string, { code: string; teleId: string }> = {};
    const referralCounts: Record<string, number> = {};
    const totalReferrals: Record<string, number> = {};
    /** 인덱스 0~4 = 1대~5대 추천인원 */
    const levelReferrals: Record<string, number[]> = {};

    if (userIds.length > 0) {
      // 1. 지갑 수
      const { data: walletData } = await this.client
        .from('wallets')
        .select('user_id')
        .in('user_id', userIds);
      (walletData || []).forEach((w) => {
        walletCounts[w.user_id] = (walletCounts[w.user_id] || 0) + 1;
      });

      // 2. 추천인 정보 (referral_code, username, first_name, telegram_uid)
      const referrerIds = Array.from(new Set((data || []).map((u) => u.referred_by).filter(Boolean)));
      if (referrerIds.length > 0) {
        const { data: referrers } = await this.client
          .from('users')
          .select('id, referral_code, username, first_name, telegram_uid')
          .in('id', referrerIds);
        (referrers || []).forEach(r => {
          referrerMap[r.id] = {
            code: r.referral_code ? String(r.referral_code) : '',
            // username 없으면 first_name, 그도 없으면 telegram_uid
            teleId: r.username || r.first_name || String(r.telegram_uid)
          };
        });
      }

      // 3. 각 유저가 추천한 회원 수 (1대 추천인, referrals 테이블 기준)
      const { data: referralData } = await this.client
        .from('referrals')
        .select('referrer_id')
        .in('referrer_id', userIds);
      (referralData || []).forEach(r => {
        referralCounts[r.referrer_id] = (referralCounts[r.referrer_id] || 0) + 1;
      });

      // 4. 총 추천인 수 + 레벨별(1~5대) 추천인 수 (get_referral_subtree RPC 한 번으로 함께 계산)
      await Promise.all(
        userIds.map(async (uid) => {
          try {
            const { data: subtree } = await this.client.rpc('get_referral_subtree', {
              root_user_id: uid,
              max_depth: 10,
            });
            const nodes = (subtree || []) as { depth: number }[];
            const levels = [0, 0, 0, 0, 0]; // 1대~5대
            let total = 0;
            nodes.forEach((n) => {
              if (n.depth >= 1) {
                total++;
                if (n.depth <= 5) levels[n.depth - 1]++;
              }
            });
            totalReferrals[uid] = total;
            levelReferrals[uid] = levels;
          } catch {
            totalReferrals[uid] = referralCounts[uid] || 0;
            levelReferrals[uid] = [referralCounts[uid] || 0, 0, 0, 0, 0];
          }
        })
      );
    }

    const users = (data || []).map((u) => ({
      id: u.id,
      telegramUid: u.telegram_uid,
      username: u.username,
      firstName: u.first_name,
      lastName: u.last_name,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at || u.created_at, // 없으면 가입일로 폴백
      referralCode: u.referral_code, // 본인의 추천코드
      referrerCode: u.referred_by ? (referrerMap[u.referred_by]?.code || null) : null,
      sponsorTeleId: u.referred_by ? (referrerMap[u.referred_by]?.teleId || null) : null,
      level1Referrals: levelReferrals[u.id]?.[0] ?? referralCounts[u.id] ?? 0,
      level2Referrals: levelReferrals[u.id]?.[1] ?? 0,
      level3Referrals: levelReferrals[u.id]?.[2] ?? 0,
      level4Referrals: levelReferrals[u.id]?.[3] ?? 0,
      level5Referrals: levelReferrals[u.id]?.[4] ?? 0,
      totalReferrals: totalReferrals[u.id] || 0,
      walletCount: walletCounts[u.id] || 0,
      adminNickname: u.admin_nickname || null,
    }));

    return { users, total: count || 0 };
  }

  /**
   * 유저 일괄 삭제
   * wallets/orders/referrals는 ON DELETE CASCADE로 자동 정리되지만,
   * transfers와 users.referred_by(자기참조)는 cascade가 없어 먼저 정리해야 함
   */
  async deleteUsers(userIds: string[]) {
    if (!userIds || userIds.length === 0) {
      throw new BadRequestException('삭제할 유저를 선택해주세요.');
    }

    // 삭제 대상을 추천인으로 등록해 둔 다른 유저들의 참조 해제
    const { error: unlinkError } = await this.client
      .from('users')
      .update({ referred_by: null })
      .in('referred_by', userIds);
    if (unlinkError) {
      this.logger.error(`Failed to unlink referred_by before delete: ${unlinkError.message}`);
      throw new BadRequestException('유저 삭제 준비에 실패했습니다.');
    }

    // transfers는 FK에 cascade가 없어 먼저 삭제
    const { error: transfersError } = await this.client
      .from('transfers')
      .delete()
      .in('user_id', userIds);
    if (transfersError) {
      this.logger.error(`Failed to delete transfers before user delete: ${transfersError.message}`);
      throw new BadRequestException('유저 삭제 준비에 실패했습니다.');
    }

    const { error } = await this.client.from('users').delete().in('id', userIds);
    if (error) {
      this.logger.error(`Failed to delete users: ${error.message}`);
      throw new BadRequestException('유저 삭제에 실패했습니다.');
    }

    return { deleted: userIds.length };
  }

  /**
   * 특정 유저의 지갑 + 잔액 정보
   */
  async getUserWallets(userId: string) {
    const { data: wallets } = await this.client
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .order('wallet_index', { ascending: true });

    return (wallets || []).map((w) => ({
      id: w.id,
      userId: w.user_id,
      publicKey: w.public_key,
      walletIndex: w.wallet_index,
      label: w.label,
      isActive: w.is_active,
      createdAt: w.created_at,
    }));
  }

  /**
   * 방장 목록 + 추천 통계
   *
   * 방장(is_sponsor=true)으로 지정된 유저만 조회.
   * 각 방장별:
   *   - directCount: 1대 추천 수 (직접 추천)
   *   - totalCount: 총 추천 수 (직접 + 하위 전체, 재귀)
   *   - weeklyCount: 최근 7일간 신규 가입한 하위 회원 수
   */
  async getReferralStats() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 방장으로 지정된 유저 조회
    const { data: sponsors, error } = await this.client
      .from('users')
      .select('id, username, first_name, referral_code, telegram_uid')
      .eq('is_sponsor', true)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to get sponsors: ${error.message}`);
      // is_sponsor 컬럼이 아직 없는 경우 → 빈 배열 반환
      if (/column.*is_sponsor|does not exist/i.test(error.message)) {
        return [];
      }
      throw error;
    }

    const result: Array<{
      referrerId: string;
      referrerName: string;
      referrerTeleId: number;
      directCount: number;
      totalCount: number;
      weeklyCount: number;
    }> = [];

    for (const sponsor of sponsors || []) {
      // 1대 추천 수 (직접 추천한 유저 수)
      const { count: directCount } = await this.client
        .from('referrals')
        .select('*', { count: 'exact', head: true })
        .eq('referrer_id', sponsor.id);

      // 총 추천 수 (하위 전체) — get_referral_subtree RPC 활용
      let totalCount = directCount || 0;
      let weeklyCount = 0;
      try {
        const { data: subtree, error: subErr } = await this.client
          .rpc('get_referral_subtree', { root_user_id: sponsor.id, max_depth: 10 });
        if (!subErr && subtree) {
          // depth >= 1 = 본인 제외 하위 전체
          const descendants = subtree.filter((n: any) => n.depth >= 1);
          totalCount = descendants.length;
          // 최근 7일 가입자
          weeklyCount = descendants.filter((n: any) =>
            n.created_at && new Date(n.created_at) >= sevenDaysAgo,
          ).length;
        }
      } catch {
        // RPC 함수 없으면 directCount만 사용
      }

      result.push({
        referrerId: sponsor.id,
        referrerName: sponsor.referral_code || sponsor.username || sponsor.first_name || '—',
        referrerTeleId: sponsor.telegram_uid,
        directCount: directCount || 0,
        totalCount,
        weeklyCount,
      });
    }

    // 총 추천 수 내림차순 정렬
    return result.sort((a, b) => b.totalCount - a.totalCount);
  }

  /**
   * 방장 지정/해제 토글
   */
  async toggleSponsor(userId: string): Promise<{ isSponsor: boolean }> {
    // 현재 상태 조회
    const { data: user, error: fetchErr } = await this.client
      .from('users')
      .select('is_sponsor')
      .eq('id', userId)
      .maybeSingle();

    if (fetchErr || !user) {
      throw new Error('유저를 찾을 수 없습니다.');
    }

    const newValue = !user.is_sponsor;

    const { error } = await this.client
      .from('users')
      .update({ is_sponsor: newValue })
      .eq('id', userId);

    if (error) {
      this.logger.error(`Failed to toggle sponsor: ${error.message}`);
      throw error;
    }

    return { isSponsor: newValue };
  }

  /**
   * 어드민이 스폰서(추천인) 수동 지정
   * 기존 추천관계(referred_by)가 없는 유저에 한해서만 허용
   *
   * @param sponsorIdentifier Tele ID(username) / 숫자 telegram_uid / 추천코드
   *   — 어드민 화면의 "Tele ID" 칼럼은 username을 표시하므로 그대로 입력해도 찾아짐
   */
  async setUserSponsor(userId: string, sponsorIdentifier: string) {
    const { data: user, error: fetchErr } = await this.client
      .from('users')
      .select('id, referred_by')
      .eq('id', userId)
      .maybeSingle();

    if (fetchErr || !user) {
      throw new BadRequestException('유저를 찾을 수 없습니다.');
    }
    if (user.referred_by) {
      throw new BadRequestException('이미 추천인이 지정된 회원입니다.');
    }

    const sponsor = await this.findUserByIdentifier(sponsorIdentifier);
    if (!sponsor) {
      throw new BadRequestException(`'${sponsorIdentifier}' 에 해당하는 회원을 찾을 수 없습니다.`);
    }
    if (sponsor.id === userId) {
      throw new BadRequestException('본인을 스폰서로 지정할 수 없습니다.');
    }

    // 순환 참조 방지 — 지정하려는 스폰서가 이미 이 유저의 하위 라인에 있으면 거부
    // (A→B 상태에서 B를 A의 스폰서로 지정하면 추천 트리가 무한 루프에 빠짐)
    if (await this.isDescendantOf(sponsor.id, userId)) {
      throw new BadRequestException('이 회원의 하위 라인에 있는 회원은 스폰서로 지정할 수 없습니다.');
    }

    const { error: updateErr } = await this.client
      .from('users')
      .update({ referred_by: sponsor.id })
      .eq('id', userId);
    if (updateErr) {
      this.logger.error(`Failed to set sponsor: ${updateErr.message}`);
      throw new BadRequestException('스폰서 지정에 실패했습니다.');
    }

    const { error: refError } = await this.client.from('referrals').insert({
      referrer_id: sponsor.id,
      referee_id: userId,
    });
    if (refError) {
      this.logger.error(`Failed to record referral for manual sponsor: ${refError.message}`);
      // referrals 기록 실패 → referred_by 롤백 (데이터 정합성)
      await this.client.from('users').update({ referred_by: null }).eq('id', userId);
      throw new BadRequestException('스폰서 관계 기록에 실패했습니다.');
    }

    this.logger.log(
      `[setUserSponsor] linked user=${userId.slice(0, 8)} → sponsor=${sponsor.id.slice(0, 8)} (${sponsorIdentifier})`,
    );
    return {
      sponsorId: sponsor.id,
      sponsorLabel: sponsor.username || sponsor.first_name || String(sponsor.telegram_uid),
    };
  }

  /**
   * Tele ID(username) / 숫자 telegram_uid / 추천코드 중 아무거나로 유저 조회
   */
  private async findUserByIdentifier(identifier: string) {
    const value = identifier.trim();
    if (!value) return null;

    const selectCols = 'id, username, first_name, telegram_uid';

    // 1) username 정확히 일치 (어드민 화면의 "Tele ID" 칼럼에 표시되는 값)
    const { data: byUsername } = await this.client
      .from('users')
      .select(selectCols)
      .eq('username', value.replace(/^@/, ''))
      .maybeSingle();
    if (byUsername) return byUsername;

    // 2) 숫자면 telegram_uid로 조회
    if (/^\d+$/.test(value)) {
      const { data: byUid } = await this.client
        .from('users')
        .select(selectCols)
        .eq('telegram_uid', Number(value))
        .maybeSingle();
      if (byUid) return byUid;
    }

    // 3) 추천코드로 조회 (대문자 정규화)
    const { data: byCode } = await this.client
      .from('users')
      .select(selectCols)
      .eq('referral_code', value.toUpperCase())
      .maybeSingle();
    if (byCode) return byCode;

    return null;
  }

  /**
   * candidateId가 rootId의 하위 라인(추천 트리)에 속하는지 확인 — 순환 참조 방지용
   */
  private async isDescendantOf(candidateId: string, rootId: string): Promise<boolean> {
    try {
      const { data: subtree } = await this.client.rpc('get_referral_subtree', {
        root_user_id: rootId,
        max_depth: 20,
      });
      return ((subtree || []) as { user_id: string; depth: number }[]).some(
        (n) => n.depth >= 1 && n.user_id === candidateId,
      );
    } catch {
      // RPC 실패 시 판단 불가 — 차단하지 않고 통과 (기존 동작 유지)
      return false;
    }
  }

  /**
   * 어드민 전용 회원 닉네임 저장 — 유저에게는 노출되지 않는 내부 식별용 메모
   */
  async setUserNickname(userId: string, nickname: string) {
    const trimmed = nickname.trim();
    const { data, error } = await this.client
      .from('users')
      .update({ admin_nickname: trimmed || null })
      .eq('id', userId)
      .select('id, admin_nickname')
      .maybeSingle();

    if (error || !data) {
      this.logger.error(`Failed to set admin nickname: ${error?.message}`);
      throw new BadRequestException('닉네임 저장에 실패했습니다.');
    }

    return { adminNickname: data.admin_nickname };
  }

  /**
   * 토큰 목록 — camelCase 변환
   */
  async getTokens() {
    const { data } = await this.client
      .from('tokens')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    // 로고 URL은 파일명 규칙으로 생성 (token-logos/{symbol-lowercase}.png)
    // DB logo_url 컬럼 의존 제거 — Storage 버킷만 사용
    return (data || []).map((t) => ({
      id: t.id,
      mintAddress: t.mint_address,
      symbol: t.symbol,
      decimals: t.decimals,
      isActive: t.is_active,
      logoUrl: this.getTokenLogoUrl(t.symbol),
      createdAt: t.created_at,
    }));
  }

  /**
   * 토큰 로고 public URL 생성 (규칙 기반)
   * 버전 쿼리스트링으로 CDN 캐시 무효화
   */
  private getTokenLogoUrl(symbol: string): string {
    const BUCKET = 'token-logos';
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${symbol.toLowerCase()}.png?v=${Date.now()}`;
  }

  /**
   * 토큰 로고 이미지 업로드 — Supabase Storage
   * 규칙: token-logos/{symbol-lowercase}.png (항상 png로 통일 저장)
   */
  async uploadTokenLogo(symbol: string, fileBuffer: Buffer): Promise<string> {
    const BUCKET = 'token-logos';
    const path = `${symbol.toLowerCase()}.png`;

    const { error } = await this.client
      .storage
      .from(BUCKET)
      .upload(path, fileBuffer, {
        contentType: 'image/png',
        upsert: true, // 덮어쓰기
      });

    if (error) {
      throw new BadRequestException(`로고 업로드 실패: ${error.message}`);
    }

    return this.getTokenLogoUrl(symbol);
  }

  /**
   * 토큰 등록
   */
  async createToken(dto: { mintAddress: string; symbol: string; decimals: number }) {
    // 중복 체크
    const { data: existing } = await this.client
      .from('tokens')
      .select('id')
      .eq('mint_address', dto.mintAddress)
      .maybeSingle();

    if (existing) {
      throw new BadRequestException('이미 등록된 토큰입니다.');
    }

    const { data, error } = await this.client
      .from('tokens')
      .insert({
        mint_address: dto.mintAddress,
        symbol: dto.symbol.toUpperCase(),
        decimals: dto.decimals,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create token: ${error.message}`);
      throw new BadRequestException('토큰 등록에 실패했습니다.');
    }

    return data;
  }

  /**
   * 토큰 활성화/비활성화 토글
   */
  async toggleToken(tokenId: string) {
    const { data: token, error: fetchError } = await this.client
      .from('tokens')
      .select('is_active')
      .eq('id', tokenId)
      .single();

    if (fetchError || !token) {
      throw new BadRequestException('토큰을 찾을 수 없습니다.');
    }

    const { data, error } = await this.client
      .from('tokens')
      .update({ is_active: !token.is_active })
      .eq('id', tokenId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to toggle token: ${error.message}`);
      throw new BadRequestException('토큰 상태 변경에 실패했습니다.');
    }

    return data;
  }

  /**
   * 토큰 완전 삭제
   */
  async deleteToken(tokenId: string) {
    // 참조된 주문이 있는지 확인
    const { count: orderCount } = await this.client
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('token_id', tokenId);

    if (orderCount && orderCount > 0) {
      throw new BadRequestException(
        `이 토큰으로 ${orderCount}개의 주문이 있습니다. 비활성화만 가능합니다.`,
      );
    }

    const { error } = await this.client
      .from('tokens')
      .delete()
      .eq('id', tokenId);

    if (error) {
      this.logger.error(`Failed to delete token: ${error.message}`);
      throw new BadRequestException('토큰 삭제에 실패했습니다.');
    }

    return { success: true };
  }

  /**
   * 전체 주문 내역 (필터 지원) — tokenSymbol 매핑 포함
   */
  async getOrders(
    options: {
      status?: string;
      tokenId?: string;
      userId?: string;
      /** Tele ID(username) / 숫자 telegram_uid / 추천코드 — 어드민이 직접 입력한 검색어 */
      userIdentifier?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{ orders: unknown[]; total: number; userNotFound?: boolean }> {
    const { status, tokenId, sortBy, sortOrder = 'desc', page = 1, pageSize = 50 } = options;
    const safePageSize = Math.min(pageSize, 200);
    const from = (page - 1) * safePageSize;
    const to = from + safePageSize - 1;

    // 유저 검색어(Tele ID/username/숫자 UID/추천코드)를 실제 user_id로 변환.
    // 일치하는 유저가 없으면 "결과 0건"이 아니라 userNotFound로 구분해 알려준다
    // (오타인지 정말 주문이 없는 건지 화면에서 구분되도록).
    let userId = options.userId;
    if (!userId && options.userIdentifier?.trim()) {
      const found = await this.findUserByIdentifier(options.userIdentifier);
      if (!found) {
        return { orders: [], total: 0, userNotFound: true };
      }
      userId = found.id as string;
    }

    // 정렬 가능한 컬럼 화이트리스트 — 임의 컬럼명이 그대로 쿼리에 들어가지 않도록 제한
    const SORTABLE = new Set([
      'created_at', 'price', 'quantity', 'fee', 'status', 'side', 'user_id', 'token_id',
    ]);
    const ascending = sortOrder === 'asc';

    const buildQuery = (orderColumn: string, asc: boolean) => {
      let q = this.client
        .from('orders')
        .select('*, users!inner(username)', { count: 'exact' })
        .order(orderColumn, { ascending: asc })
        // 정렬 키가 같은 행끼리는 최신순으로 — 페이지 경계에서 순서가 흔들리지 않도록 보조 정렬
        .order('created_at', { ascending: false })
        .range(from, to);

      if (status) q = q.eq('status', status);
      if (tokenId) q = q.eq('token_id', tokenId);
      if (userId) q = q.eq('user_id', userId);
      return q;
    };

    const orderColumn = sortBy && SORTABLE.has(sortBy) ? sortBy : 'created_at';
    let { data, count, error } = await buildQuery(orderColumn, ascending);

    // 정렬 컬럼 문제로 실패하면 기본 정렬로 폴백 — 정렬 때문에 목록 자체가 안 나오는 일 방지
    if (error && orderColumn !== 'created_at') {
      this.logger.warn(`Order sort by '${orderColumn}' failed, falling back to created_at: ${error.message}`);
      ({ data, count } = await buildQuery('created_at', false));
    }

    // 토큰 심볼 매핑
    const tokenIds = [...new Set((data || []).map((o) => o.token_id))];
    const tokenMap: Record<string, string> = {};
    if (tokenIds.length > 0) {
      const { data: tokens } = await this.client
        .from('tokens')
        .select('id, symbol')
        .in('id', tokenIds);
      (tokens || []).forEach((t) => {
        tokenMap[t.id] = t.symbol;
      });
    }

    const orders = (data || []).map((o) => ({
      id: o.id,
      userId: o.user_id,
      tokenSymbol: tokenMap[o.token_id] || '—',
      username: (o.users as { username?: string })?.username || '—',
      side: o.side,
      price: o.price,
      quantity: o.quantity,
      filledQty: o.filled_qty ?? 0,
      fee: o.fee,
      status: o.status,
      txSignature: o.tx_signature,
      cancelTxSignature: o.cancel_tx_signature ?? null,
      createdAt: o.created_at,
      updatedAt: o.updated_at || null,
      statusMessage: this.buildOrderStatusMessage(o),
    }));

    return { orders, total: count || 0 };
  }

  /**
   * 주문 상태를 사람이 읽을 수 있는 상세 메시지로 변환
   *
   * orders 테이블에 실패 사유를 저장하는 컬럼이 없으므로, 보유한 필드
   * (tx_signature / manifest_* / filled_qty / order_type)의 조합으로 어느
   * 단계에서 멈췄는지를 추론해 알려준다.
   */
  private buildOrderStatusMessage(o: Record<string, unknown>): string {
    const status = String(o.status ?? '');
    const hasTx = !!o.tx_signature;
    const hasSeq = o.manifest_sequence_number != null;
    const qty = Number(o.quantity ?? 0);
    const filled = Number(o.filled_qty ?? 0);
    const orderType = String(o.order_type ?? 'limit');
    const typeLabel = orderType === 'market' ? '시장가' : '지정가';

    switch (status) {
      case 'filled':
        return filled > 0 && filled < qty
          ? `부분 체결 — ${filled}/${qty} 체결됨 (${typeLabel})`
          : `체결 완료 — 전량 ${qty} 체결 (${typeLabel})`;

      case 'partially_filled':
        return `부분 체결 중 — ${filled}/${qty} 체결됨 (${typeLabel})`;

      case 'active':
        if (!hasTx) {
          return '주문 생성됨 — 아직 체인에 제출되지 않음 (서명 대기/중단)';
        }
        // 부분 체결 감지 — filled_qty > 0이면 크랭크 체결이 있었음
        if (filled > 0 && filled < qty) {
          return `부분 체결 중 — ${filled}/${qty} 체결됨 (${typeLabel})`;
        }
        return hasSeq
          ? `오더북 등록 완료 — 체결 대기 중 (${typeLabel})`
          : '체인 제출됨 — 오더북 등록 확인 중';

      case 'submitted':
        return hasTx
          ? '체인에 제출됨 — 블록 포함 확인 중'
          : '제출 처리 중 — Tx 미생성';

      case 'cancelled':
        return filled > 0
          ? `취소됨 — 취소 전 ${filled}/${qty} 체결`
          : '취소됨 — 체결 없이 전량 취소';

      case 'expired':
        if (!hasTx) {
          return '만료 — 체인 제출 전 단계에서 종료됨';
        }
        return filled > 0
          ? `만료 — ${filled}/${qty} 체결 후 나머지 소멸`
          : '만료 — 체결되지 않은 채 유효기간 종료';

      case 'failed':
        if (!hasTx) {
          // DEX가 주문 tx 자체를 만들어주지 못한 경우 (예: 해당 페어의 마켓 미존재)
          return 'DEX 주문 생성 실패 — 거래 마켓이 없거나 DEX가 요청을 거부함 (Tx 미생성)';
        }
        return '체인 제출 실패 — 트랜잭션이 블록에 반영되지 못함';

      default:
        return status || '—';
    }
  }

  /**
   * 수수료 수익 상세 대장
   */
  async getRevenueLedger(page = 1, pageSize = 50) {
    const safePageSize = Math.min(pageSize, 200);
    const from = (page - 1) * safePageSize;
    const to = from + safePageSize - 1;

    const { data, count } = await this.client
      .from('orders')
      .select(`
        id, fee, fee_rate, side, price, quantity, status, tx_signature, created_at,
        users!inner(username, telegram_uid),
        tokens!inner(symbol)
      `, { count: 'exact' })
      .gt('fee', 0)
      .order('created_at', { ascending: false })
      .range(from, to);

    const ledger = (data || []).map((o) => {
      const price = Number(o.price) || 0;
      const quantity = Number(o.quantity) || 0;
      const tradeAmount = price * quantity;
      const user = o.users as { username?: string; telegram_uid?: number } | null;
      return {
        orderId: o.id,
        fee: o.fee,
        feeRate: o.fee_rate,
        side: o.side,
        price: o.price,
        quantity: o.quantity,
        tradeAmount,
        txSignature: o.tx_signature,
        status: o.status,
        createdAt: o.created_at,
        username: user?.username || '—',
        telegramUid: user?.telegram_uid,
        tokenSymbol: (o.tokens as { symbol?: string })?.symbol || '—',
      };
    });

    // 총계
    const { data: totalData } = await this.client
      .from('orders')
      .select('fee')
      .eq('status', 'filled');

    const totalRevenue = (totalData || []).reduce((sum, o) => sum + Number(o.fee || 0), 0);

    return { ledger, total: count || 0, totalRevenue };
  }

  // ========================================
  // 추천 조직도 트리
  // ========================================

  async getReferralTree(userId: string, maxDepth = 5) {
    const { data: subtree, error: treeError } = await this.client
      .rpc('get_referral_subtree', { root_user_id: userId, max_depth: maxDepth });
    if (treeError) {
      this.logger.error('Failed to get referral tree: ' + treeError.message);
      throw treeError;
    }
    const { data: ancestorsRaw, error: ancError } = await this.client
      .rpc('get_referral_ancestors', { user_id: userId });
    const nodes = ((subtree || []) as Record<string, unknown>[]).map((r) => ({
      id: r.user_id as string,
      username: r.username as string | null,
      firstName: r.first_name as string,
      telegramUid: r.telegram_uid as number,
      referralCode: r.referral_code as string | null,
      depth: r.depth as number,
      createdAt: r.created_at as string,
      childrenCount: 0,
      children: [] as TreeNodeShape[],
    }));
    const countMap: Record<string, number> = {};
    for (let i = 1; i < nodes.length; i++) {
      for (let j = i - 1; j >= 0; j--) {
        if (nodes[j].depth === nodes[i].depth - 1) {
          countMap[nodes[j].id] = (countMap[nodes[j].id] || 0) + 1;
          break;
        }
      }
    }
    for (const node of nodes) node.childrenCount = countMap[node.id] || 0;
    const tree = this.buildTree(nodes);
    const ancestors = (((ancError ? [] : ancestorsRaw) || []) as Record<string, unknown>[]).map((r) => ({
      id: r.user_id as string,
      username: r.username as string | null,
      firstName: r.first_name as string,
      referralCode: r.referral_code as string | null,
      depth: r.depth as number,
    }));
    const perLevelCounts: Record<number, number> = {};
    let maxD = 0;
    for (const node of nodes) {
      perLevelCounts[node.depth] = (perLevelCounts[node.depth] || 0) + 1;
      if (node.depth > maxD) maxD = node.depth;
    }
    return { tree, ancestors, stats: { totalNodes: nodes.length, maxDepth: maxD, perLevelCounts } };
  }

  private buildTree(nodes: TreeNodeShape[]): TreeNodeShape | null {
    if (nodes.length === 0) return null;
    const depthStack: number[] = [-1];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.depth === 0) { depthStack[0] = i; }
      else {
        const parentIdx = depthStack[node.depth - 1];
        if (parentIdx >= 0) nodes[parentIdx].children.push(node);
        depthStack[node.depth] = i;
      }
    }
    return nodes[0];
  }

  async getReferralRoots() {
    const { data, error } = await this.client.rpc('get_referral_roots');
    if (error) {
      this.logger.error('Failed to get referral roots: ' + error.message);
      throw error;
    }
    return ((data || []) as Record<string, unknown>[]).map((r) => ({
      id: r.user_id as string,
      username: r.username as string | null,
      firstName: r.first_name as string,
      telegramUid: r.telegram_uid as number,
      referralCode: r.referral_code as string | null,
      directCount: r.direct_count as number,
      createdAt: r.created_at as string,
    }));
  }

  /**
   * 토큰 순서 변경 (Bulk update)
   */
  async reorderTokens(orderMap: { [tokenId: string]: number }) {
    // Supabase JS client doesn't support bulk update natively in a single query easily without RPC,
    // so we'll do it sequentially or in parallel since it's an admin operation.
    const promises = Object.entries(orderMap).map(([id, sortOrder]) =>
      this.client.from('tokens').update({ sort_order: sortOrder }).eq('id', id)
    );

    const results = await Promise.all(promises);
    const errors = results.filter(r => r.error);
    
    if (errors.length > 0) {
      this.logger.error(`Failed to reorder some tokens: ${errors[0].error?.message}`);
      throw new Error('일부 토큰의 순서를 변경하지 못했습니다.');
    }

    return true;
  }

  // ========================================
  // 설정 관리 (수수료율 등)
  // ========================================

  /**
   * 설정값 조회 (문자열)
   */
  async getSetting(key: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('settings')
      .select('value')
      .eq('key', key)
      .single();

    if (error || !data) return null;
    return data.value;
  }

  /**
   * 수수료율 조회 (number, 기본값 0.01)
   */
  async getFeeRate(): Promise<number> {
    const value = await this.getSetting('fee_rate');
    const rate = value ? Number(value) : NaN;
    return Number.isFinite(rate) ? rate : 0.01;
  }

  /**
   * 수수료율 수정 (검증: 0 ~ 0.5 범위)
   */
  async updateFeeRate(rate: number): Promise<{ feeRate: number }> {
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) {
      throw new BadRequestException('수수료율은 0~50% 범위여야 합니다.');
    }

    const { error } = await this.client
      .from('settings')
      .upsert({ key: 'fee_rate', value: String(rate), updated_at: new Date().toISOString() });

    if (error) {
      this.logger.error('Failed to update fee rate: ' + error.message);
      throw error;
    }

    return { feeRate: rate };
  }

}
