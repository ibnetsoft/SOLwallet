import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * Telegram UID로 사용자 조회
   */
  async findByTelegramUid(telegramUid: number) {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('telegram_uid', telegramUid)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to find user: ${error.message}`);
      throw error;
    }

    return data;
  }

  /**
   * 사용자 생성 (upsert 기반) — username, first_name, last_name 모두 동기화
   */
  async upsertUser(params: {
    telegramUid: number;
    username?: string;
    firstName: string;
    lastName: string;
    referredBy?: string;
  }) {
    // 기존 유저 확인
    const existing = await this.findByTelegramUid(params.telegramUid);

    if (existing) {
      // username, first_name, last_name 중 변경된 것이 있으면 업데이트
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      let needsUpdate = false;

      if (params.username !== undefined && params.username !== existing.username) {
        updates.username = params.username;
        needsUpdate = true;
      }
      if (params.firstName && params.firstName !== existing.first_name) {
        updates.first_name = params.firstName;
        needsUpdate = true;
      }
      if (params.lastName !== existing.last_name) {
        updates.last_name = params.lastName;
        needsUpdate = true;
      }

      if (needsUpdate) {
        const { data, error } = await this.client
          .from('users')
          .update(updates)
          .eq('id', existing.id)
          .select()
          .single();

        if (error) {
          this.logger.error(`Failed to update user: ${error.message}`);
          throw error;
        }
        return data;
      }
      return existing;
    }

    // 신규 유저 생성
    const insertData: Record<string, unknown> = {
      telegram_uid: params.telegramUid,
      username: params.username || null,
      first_name: params.firstName,
      last_name: params.lastName,
    };

    // 추천인 코드가 있으면 referred_by 설정
    if (params.referredBy) {
      insertData.referred_by = params.referredBy;
    }

    const { data, error } = await this.client
      .from('users')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create user: ${error.message}`);
      throw error;
    }

    // 추천인 관계가 있으면 referrals 테이블에도 기록 (에러 시 로그만)
    if (params.referredBy && data) {
      const { error: refError } = await this.client.from('referrals').insert({
        referrer_id: params.referredBy,
        referee_id: data.id,
      });
      if (refError) {
        this.logger.warn(`Failed to record referral: ${refError.message}`);
      }
    }

    return data;
  }

  /**
   * 사용자 ID로 조회
   */
  async findById(userId: string) {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      this.logger.error(`Failed to find user by id: ${error.message}`);
      throw error;
    }

    return data;
  }

  /**
   * 사용자 프로필 + 추천인 정보 조회
   */
  async getUserProfile(userId: string) {
    const { data: user, error } = await this.client
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      this.logger.error(`Failed to get user profile: ${error.message}`);
      throw error;
    }

    // 추천인 정보 조회
    let referrer = null;
    if (user.referred_by) {
      const { data: ref } = await this.client
        .from('users')
        .select('username, first_name')
        .eq('id', user.referred_by)
        .maybeSingle();
      referrer = ref;
    }

    // 내가 추천한 유저 수
    const { count: refCount } = await this.client
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', userId);

    return {
      ...user,
      referrer,
      referralCount: refCount || 0,
      referralCode: user.id, // 본인 ID가 추천 코드
    };
  }

  /**
   * 사용자의 지갑 목록 조회
   */
  async getUserWallets(userId: string) {
    const { data, error } = await this.client
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .order('wallet_index', { ascending: true });

    if (error) {
      this.logger.error(`Failed to get wallets: ${error.message}`);
      throw error;
    }

    return data || [];
  }
}
