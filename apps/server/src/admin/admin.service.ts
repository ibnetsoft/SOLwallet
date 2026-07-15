import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { AdminStats, AdminUserDetail, AdminTokenDetail, AdminOrderDetail } from '@solwallet/shared-types';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

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

    // 총 수수료 수익
    const { data: feeData } = await this.client
      .from('orders')
      .select('fee');

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
      .eq('status', 'active');

    return {
      totalUsers: totalUsers || 0,
      todaySignups: todaySignups || 0,
      totalFeeRevenue: Math.round(totalFeeRevenue * 1e6) / 1e6,
      totalOrders: totalOrders || 0,
      activeOrders: activeOrders || 0,
    };
  }

  /**
   * 유저 목록 (페이지네이션)
   */
  async getUsers(page = 1, pageSize = 20): Promise<{ users: AdminUserDetail[]; total: number }> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, count } = await this.client
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, to);

    // 각 유저의 지갑 수 조회
    const users: AdminUserDetail[] = (data || []).map((u) => ({
      id: u.id,
      telegramUid: String(u.telegram_uid),
      username: u.username || '',
      firstName: u.first_name || '',
      lastName: u.last_name || '',
      referredBy: u.referred_by || null,
      walletCount: 0, // 아래에서 채움
      createdAt: u.created_at,
    }));

    return { users, total: count || 0 };
  }

  /**
   * 특정 유저의 지갑 + 잔액 조회
   */
  async getUserWallets(userId: string) {
    const { data: wallets } = await this.client
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .order('wallet_index', { ascending: true });

    return wallets || [];
  }

  /**
   * 토큰 목록
   */
  async getTokens(): Promise<AdminTokenDetail[]> {
    const { data } = await this.client
      .from('tokens')
      .select('*')
      .order('created_at', { ascending: false });

    return (data || []).map((t) => ({
      id: t.id,
      mintAddress: t.mint_address,
      symbol: t.symbol,
      decimals: t.decimals,
      isActive: t.is_active,
      createdAt: t.created_at,
    }));
  }

  /**
   * 토큰 등록
   */
  async createToken(dto: { mintAddress: string; symbol: string; decimals: number }) {
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
    // 현재 상태 조회
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
      throw error;
    }

    return data;
  }

  /**
   * 전체 주문 내역 (필터 지원)
   */
  async getOrders(
    options: { status?: string; tokenId?: string; page?: number; pageSize?: number } = {},
  ): Promise<{ orders: AdminOrderDetail[]; total: number }> {
    const { status, tokenId, page = 1, pageSize = 50 } = options;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

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

    // 토큰 심볼 매핑을 위한 조회
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

    const orders: AdminOrderDetail[] = (data || []).map((o) => ({
      id: o.id,
      userId: o.user_id,
      username: o.users?.username || '—',
      tokenSymbol: tokenMap[o.token_id] || '—',
      side: o.side,
      price: o.price,
      quantity: o.quantity,
      fee: o.fee,
      status: o.status,
      txSignature: o.tx_signature || null,
      createdAt: o.created_at,
    }));

    return { orders, total: count || 0 };
  }
}
