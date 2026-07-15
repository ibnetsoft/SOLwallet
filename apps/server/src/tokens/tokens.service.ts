import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * 활성화된 토큰 목록 조회
   */
  async getActiveTokens() {
    const { data, error } = await this.client
      .from('tokens')
      .select('*')
      .eq('is_active', true)
      .order('symbol', { ascending: true });

    if (error) {
      this.logger.error(`Failed to get tokens: ${error.message}`);
      throw error;
    }

    return data || [];
  }
}
