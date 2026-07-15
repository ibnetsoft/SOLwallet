import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Wallet } from '@solwallet/shared-types';

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
   * 사용자 생성 (upsert 기반)
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
      // username이 변경되었으면 업데이트
      if (params.username && params.username !== existing.username) {
        const { data, error } = await this.client
          .from('users')
          .update({ username: params.username, updated_at: new Date().toISOString() })
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

    // 추천인 관계가 있으면 referrals 테이블에도 기록
    if (params.referredBy && data) {
      await this.client.from('referrals').insert({
        referrer_id: params.referredBy,
        referee_id: data.id,
      });
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
   * 사용자의 지갑 목록 조회
   */
  async getUserWallets(userId: string): Promise<Wallet[]> {
    const { data, error } = await this.client
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .order('wallet_index', { ascending: true });

    if (error) {
      this.logger.error(`Failed to get wallets: ${error.message}`);
      throw error;
    }

    return (data || []) as unknown as Wallet[];
  }
}
