import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// 추천코드 생성용 문자셋 — 혼동되는 문자 (0/O, 1/I/L) 제외
const REFERRAL_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REFERRAL_CODE_LENGTH = 8;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * 8자리 랜덤 추천코드 생성 (대문자 + 숫자, 혼동 문자 제외)
   * 중복 시 최대 5회 재시도
   */
  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      let code = '';
      for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
        code += REFERRAL_CHARSET[Math.floor(Math.random() * REFERRAL_CHARSET.length)];
      }

      // 중복 확인
      const { data: existing } = await this.client
        .from('users')
        .select('id')
        .eq('referral_code', code)
        .maybeSingle();

      if (!existing) return code;
    }
    // 최후의 수단 — 타임스탬프 기반
    return `R${Date.now().toString(36).toUpperCase().slice(-7)}`;
  }

  /**
   * 추천코드로 추천인(referrer) 조회
   * @returns referrer의 user id 또는 null
   */
  private async findReferrerIdByCode(code: string): Promise<string | null> {
    if (!code || code.length < 4) return null;

    const { data, error } = await this.client
      .from('users')
      .select('id')
      .eq('referral_code', code.toUpperCase().trim())
      .maybeSingle();

    if (error) {
      this.logger.warn(`Failed to find referrer by code: ${error.message}`);
      return null;
    }
    return data?.id ?? null;
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
   * referralCode(문자열)를 받아 referrer user id로 변환 후 연결
   */
  async upsertUser(params: {
    telegramUid: number;
    username?: string;
    firstName: string;
    lastName: string;
    referralCode?: string;
  }) {
    // 기존 유저 확인
    const existing = await this.findByTelegramUid(params.telegramUid);

    if (existing) {
      // username, first_name, last_name 중 변경된 것이 있으면 업데이트
      // 로그인 시 항상 last_login_at 갱신 (컬럼 없으면 업데이트 생략)
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
      };
      let needsUpdate = true; // last_login_at 갱신으로 무조건 update 실행

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

      // 기존 유저의 referral_code가 없으면 발급 (이전 마이그레이션 누락분 보정)
      if (!existing.referral_code) {
        updates.referral_code = await this.generateUniqueReferralCode();
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
          // last_login_at 컬럼이 없는 경우 → 제외 후 재시도
          if (error.message.includes('last_login_at')) {
            this.logger.warn(`last_login_at column missing, retrying without it`);
            const { data: retryData, error: retryError } = await this.client
              .from('users')
              .update({ updated_at: updates.updated_at, username: updates.username, first_name: updates.first_name, last_name: updates.last_name, referral_code: updates.referral_code })
              .eq('id', existing.id)
              .select()
              .single();
            if (retryError) {
              this.logger.error(`Failed to update user: ${retryError.message}`);
              throw retryError;
            }
            return retryData;
          }
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
      referral_code: await this.generateUniqueReferralCode(),
      last_login_at: new Date().toISOString(),
    };

    // last_login_at 컬럼이 없는 DB를 위한 fallback insert data
    const insertDataFallback: Record<string, unknown> = {
      telegram_uid: params.telegramUid,
      username: params.username || null,
      first_name: params.firstName,
      last_name: params.lastName,
      referral_code: insertData.referral_code,
    };

    // 추천인 코드 → referrer user id 변환 후 연결 (자기 자신 추천 방지)
    let referrerId: string | null = null;
    if (params.referralCode) {
      referrerId = await this.findReferrerIdByCode(params.referralCode);
      if (referrerId) {
        insertData.referred_by = referrerId;
      } else {
        this.logger.warn(`Invalid referral code: ${params.referralCode}`);
      }
    }

    let insertPayload = insertData;

    const { data, error } = await this.client
      .from('users')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      // last_login_at 컬럼이 없는 경우 → 제외 후 재시도
      if (error.message.includes('last_login_at') && insertPayload !== insertDataFallback) {
        this.logger.warn(`last_login_at column missing on insert, retrying without it`);
        if (referrerId) insertDataFallback.referred_by = referrerId;
        const { data: retryData, error: retryError } = await this.client
          .from('users')
          .insert(insertDataFallback)
          .select()
          .single();
        if (retryError) {
          this.logger.error(`Failed to create user: ${retryError.message}`);
          throw retryError;
        }
        return retryData;
      }
      this.logger.error(`Failed to create user: ${error.message}`);
      throw error;
    }

    // 추천인 관계가 있으면 referrals 테이블에도 기록 (에러 시 로그만)
    if (referrerId && data) {
      const { error: refError } = await this.client.from('referrals').insert({
        referrer_id: referrerId,
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

    // 내가 추천한 유저 수 (1대 추천)
    const { count: refCount } = await this.client
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', userId);

    // 총 추천인 수 (하위 전체) — get_referral_subtree RPC
    let totalReferralCount = refCount || 0;
    try {
      const { data: subtree } = await this.client
        .rpc('get_referral_subtree', { root_user_id: userId, max_depth: 10 });
      if (subtree) {
        // depth >= 1 = 본인 제외 하위 전체
        totalReferralCount = subtree.filter((n: any) => n.depth >= 1).length;
      }
    } catch {
      // RPC 함수 없으면 1대 추천수만 사용
    }

    return {
      ...user,
      referrer,
      referralCount: refCount || 0,        // 1대 추천 수 (직접 추천)
      totalReferralCount,                   // 총 추천 수 (하위 전체)
      referralCode: user.referral_code || user.id, // 8자리 코드 우선, 없으면 ID fallback
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
