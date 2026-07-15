import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MAX_WALLETS } from '@solwallet/config';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * 사용자의 지갑 목록 조회
   */
  async findByUser(userId: string) {
    const { data, error } = await this.client
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .order('wallet_index', { ascending: true });

    if (error) {
      this.logger.error(`Failed to find wallets: ${error.message}`);
      throw error;
    }

    return data || [];
  }

  /**
   * 사용자의 지갑 개수 조회
   */
  async countByUser(userId: string): Promise<number> {
    const { count, error } = await this.client
      .from('wallets')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Failed to count wallets: ${error.message}`);
      throw error;
    }

    return count || 0;
  }

  /**
   * 지갑 등록 (public key만 저장 — private key는 클라이언트에서 보관)
   */
  async registerWallet(params: {
    userId: string;
    publicKey: string;
    label?: string;
  }) {
    // 최대 지갑 수 확인
    const currentCount = await this.countByUser(params.userId);
    if (currentCount >= MAX_WALLETS) {
      throw new BadRequestException(
        `최대 ${MAX_WALLETS}개의 지갑만 생성할 수 있습니다.`,
      );
    }

    // 새 지갑의 인덱스 결정 (빈 슬롯 찾기)
    const existingWallets = await this.findByUser(params.userId);
    const usedIndices = new Set(existingWallets.map((w) => w.wallet_index));
    let nextIndex = 0;
    for (let i = 0; i < MAX_WALLETS; i++) {
      if (!usedIndices.has(i)) {
        nextIndex = i;
        break;
      }
    }

    // 첫 지갑이면 활성, 아니면 비활성
    const isActive = currentCount === 0;

    const { data, error } = await this.client
      .from('wallets')
      .insert({
        user_id: params.userId,
        public_key: params.publicKey,
        wallet_index: nextIndex,
        label: params.label || `Wallet ${nextIndex + 1}`,
        is_active: isActive,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to register wallet: ${error.message}`);
      throw error;
    }

    return data;
  }

  /**
   * 활성 지갑 전환
   */
  async setActiveWallet(userId: string, walletId: string) {
    // 모든 지갑을 비활성으로 (에러 체크 추가)
    const { error: deactivateError } = await this.client
      .from('wallets')
      .update({ is_active: false })
      .eq('user_id', userId);

    if (deactivateError) {
      this.logger.error(`Failed to deactivate wallets: ${deactivateError.message}`);
      throw deactivateError;
    }

    // 대상 지갑만 활성으로
    const { data, error } = await this.client
      .from('wallets')
      .update({ is_active: true })
      .eq('id', walletId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to activate wallet: ${error.message}`);
      throw error;
    }

    if (!data) {
      throw new BadRequestException('지갑을 찾을 수 없습니다.');
    }

    return data;
  }

  /**
   * 지갑 삭제
   */
  async deleteWallet(userId: string, walletId: string) {
    const { error } = await this.client
      .from('wallets')
      .delete()
      .eq('id', walletId)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Failed to delete wallet: ${error.message}`);
      throw error;
    }

    return { success: true };
  }
}
