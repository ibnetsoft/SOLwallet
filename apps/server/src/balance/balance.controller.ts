import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@Controller('balance')
@UseGuards(JwtAuthGuard)
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  /**
   * GET /api/balance/:walletAddress — 특정 지갑 잔액
   */
  @Get(':walletAddress')
  async getBalance(@Param('walletAddress') walletAddress: string) {
    const balance = await this.balanceService.getFullBalance(walletAddress);
    return { success: true, data: balance };
  }

  /**
   * GET /api/portfolio — 유저 포트폴리오
   */
  @Get()
  async getPortfolio(@Req() req: Request) {
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    const portfolio = await this.balanceService.getPortfolio(userId);

    return { success: true, data: portfolio };
  }
}
