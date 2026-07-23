import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * 공개 설정 서비스 — 미니앱이 인증 없이 조회하는 설정값
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * 수수료율 조회 (기본값 0.01 = 1%)
   */
  async getFeeRate(): Promise<number> {
    const { data, error } = await this.client
      .from('settings')
      .select('value')
      .eq('key', 'fee_rate')
      .single();

    if (error || !data) {
      return 0.01;
    }

    const rate = Number(data.value);
    return Number.isFinite(rate) ? rate : 0.01;
  }
}
