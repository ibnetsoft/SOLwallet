import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import type { AdminStats } from '@solwallet/shared-types';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * 대시보드 통계 조회
   */
  async getStats(): Promise<AdminStats> {
    // 총 유저 수
    const { count: totalUsers } = await this.client
      .from('users')
      .select('*', { count: 'exact', head: true });

    // 오늘 신규 가입
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: todaySignups } = await this.client
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    // 총 수수료 수익 (filled + submitted 상태만)
    const { data: feeData } = await this.client
      .from('orders')
      .select('fee')
      .in('status', ['filled', 'submitted']);

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
   * 유저 목록 (페이지네이션) — walletCount 실제 계산
   */
  async getUsers(page = 1, pageSize = 20) {
    // pageSize 상한선 (DoS 방지)
    const safePageSize = Math.min(pageSize, 100);
    const from = (page - 1) * safePageSize;
    const to = from + safePageSize - 1;

    const { data, count } = await this.client
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, to);

    // 각 유저의 지갑 수 조회 (배치)
    const userIds = (data || []).map((u) => u.id);
    const walletCounts: Record<string, number> = {};
    if (userIds.length > 0) {
      const { data: walletData } = await this.client
        .from('wallets')
        .select('user_id')
        .in('user_id', userIds);
      (walletData || []).forEach((w) => {
        walletCounts[w.user_id] = (walletCounts[w.user_id] || 0) + 1;
      });
    }

    const users = (data || []).map((u) => ({
      ...u,
      walletCount: walletCounts[u.id] || 0,
    }));

    return { users, total: count || 0 };
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
   * 방장(추천인) 7일 실적 통계
   */
  async getReferralStats() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 지난 7일간의 추천 기록 조회
    const { data: recentReferrals, error } = await this.client
      .from('referrals')
      .select(`
        referrer_id,
        referee_id,
        created_at,
        users!referrals_referrer_id_fkey(username, first_name),
        referee:users!referrals_referee_id_fkey(created_at)
      `)
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to get referral stats: ${error.message}`);
      throw error;
    }

    // 방장별 집계
    const stats: Record<string, {
      referrerId: string;
      referrerName: string;
      weeklyCount: number;
      totalCount: number;
    }> = {};

    for (const ref of recentReferrals || []) {
      const refId = ref.referrer_id;
      if (!stats[refId]) {
        // 전체 추천 수 조회
        const { count: totalCount } = await this.client
          .from('referrals')
          .select('*', { count: 'exact', head: true })
          .eq('referrer_id', refId);

        const referrerUser = ref.users as unknown as { username: string; first_name: string };
        stats[refId] = {
          referrerId: refId,
          referrerName: referrerUser?.username || referrerUser?.first_name || '—',
          weeklyCount: 0,
          totalCount: totalCount || 0,
        };
      }
      stats[refId].weeklyCount++;
    }

    return Object.values(stats).sort((a, b) => b.weeklyCount - a.weeklyCount);
  }

  /**
   * 토큰 목록 — camelCase 변환
   */
  async getTokens() {
    const { data } = await this.client
      .from('tokens')
      .select('*')
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
    options: { status?: string; tokenId?: string; page?: number; pageSize?: number } = {},
  ) {
    const { status, tokenId, page = 1, pageSize = 50 } = options;
    const safePageSize = Math.min(pageSize, 200);
    const from = (page - 1) * safePageSize;
    const to = from + safePageSize - 1;

    let query = this.client
      .from('orders')
      .select('*, users!inner(username)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) {
      query = query.eq('status', status);
    }
    if (tokenId) {
      query = query.eq('token_id', tokenId);
    }

    const { data, count } = await query;

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
      ...o,
      tokenSymbol: tokenMap[o.token_id] || '—',
      username: (o.users as { username?: string })?.username || '—',
    }));

    return { orders, total: count || 0 };
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
        id, fee, fee_rate, side, price, quantity, status, created_at,
        users!inner(username),
        tokens!inner(symbol)
      `, { count: 'exact' })
      .gt('fee', 0)
      .order('created_at', { ascending: false })
      .range(from, to);

    const ledger = (data || []).map((o) => ({
      orderId: o.id,
      fee: o.fee,
      feeRate: o.fee_rate,
      side: o.side,
      price: o.price,
      quantity: o.quantity,
      status: o.status,
      createdAt: o.created_at,
      username: (o.users as { username?: string })?.username || '—',
      tokenSymbol: (o.tokens as { symbol?: string })?.symbol || '—',
    }));

    // 총계
    const { data: totalData } = await this.client
      .from('orders')
      .select('fee')
      .in('status', ['filled', 'submitted']);

    const totalRevenue = (totalData || []).reduce((sum, o) => sum + Number(o.fee || 0), 0);

    return { ledger, total: count || 0, totalRevenue };
  }
}
