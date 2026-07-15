import { Controller, Get, UseGuards } from '@nestjs/common';
import { TokensService } from './tokens.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@Controller('tokens')
@UseGuards(JwtAuthGuard)
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  /**
   * GET /api/tokens — 활성 토큰 목록
   */
  @Get()
  async getTokens() {
    const tokens = await this.tokensService.getActiveTokens();
    return { success: true, data: tokens };
  }
}
