import { Controller, Get, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../common/interfaces/authenticated-request';
import { SupabaseService } from '../supabase/supabase.service';

@Controller('balance')
@UseGuards(JwtAuthGuard)
export class BalanceController {
  constructor(
    private readonly balanceService: BalanceService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * GET /api/balance/:walletAddress — 본인 지갑 잔액
   * 소유권 검증: walletAddress가 userId의 지갑인지 확인
   */
  @Get(':walletAddress')
  async getBalance(
    @CurrentUser() userId: string,
    @Param('walletAddress') walletAddress: string,
  ) {
    // 소유권 검증
    const { data: wallet } = await this.supabaseService
      .getClient()
      .from('wallets')
      .select('id')
      .eq('public_key', walletAddress)
      .eq('user_id', userId)
      .maybeSingle();

    if (!wallet) {
      throw new BadRequestException('본인 지갑만 조회할 수 있습니다.');
    }

    const balance = await this.balanceService.getFullBalance(walletAddress);
    return { success: true, data: balance };
  }

  /**
   * GET /api/balance — 유저 포트폴리오
   */
  @Get()
  async getPortfolio(@CurrentUser() userId: string) {
    const portfolio = await this.balanceService.getPortfolio(userId);
    return { success: true, data: portfolio };
  }
}
