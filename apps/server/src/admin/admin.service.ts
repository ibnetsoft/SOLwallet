import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import type { AdminStats } from '@solwallet/shared-types';

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

      // 4. 총 추천인 수 (get_referral_subtree RPC로 depth>=1 카운트)
      await Promise.all(
        userIds.map(async (uid) => {
          try {
            const { data: subtree } = await this.client.rpc('get_referral_subtree', {
              root_user_id: uid,
              max_depth: 10,
            });
            totalReferrals[uid] = (subtree || []).filter((n: any) => n.depth >= 1).length;
          } catch {
            totalReferrals[uid] = referralCounts[uid] || 0;
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
      level1Referrals: referralCounts[u.id] || 0,
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
   * 어드민이 Tele ID로 스폰서(추천인) 수동 지정
   * 기존 추천관계(referred_by)가 없는 유저에 한해서만 허용
   */
  async setUserSponsor(userId: string, sponsorTelegramUid: number) {
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

    const { data: sponsor, error: sponsorErr } = await this.client
      .from('users')
      .select('id')
      .eq('telegram_uid', sponsorTelegramUid)
      .maybeSingle();

    if (sponsorErr || !sponsor) {
      throw new BadRequestException('해당 Tele ID의 회원을 찾을 수 없습니다.');
    }
    if (sponsor.id === userId) {
      throw new BadRequestException('본인을 스폰서로 지정할 수 없습니다.');
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

    return { sponsorId: sponsor.id, sponsorTelegramUid };
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
      id: o.id,
      userId: o.user_id,
      tokenSymbol: tokenMap[o.token_id] || '—',
      username: (o.users as { username?: string })?.username || '—',
      side: o.side,
      price: o.price,
      quantity: o.quantity,
      fee: o.fee,
      status: o.status,
      txSignature: o.tx_signature,
      createdAt: o.created_at,
      updatedAt: o.updated_at || null,
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
