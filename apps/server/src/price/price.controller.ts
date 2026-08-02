import { Controller, Get, Param } from '@nestjs/common';
import { PriceService } from './price.service';

/**
 * 가격 조회 컨트롤러 — 인증 없이 퍼블릭 접근 가능
 *
 * 홈 진입 직후(JWT 토큰 없음)에도 가격 표시가 가능해야 하므로
 * JwtAuthGuard를 적용하지 않습니다.
 */
@Controller('price')
export class PriceController {
  constructor(private readonly priceService: PriceService) {}

  /**
   * GET /api/price/sol — SOL 시세 (Manifest SOL/USDC 우선, Jupiter 폴백)
   */
  @Get('sol')
  async getSolPrice() {
    const result = await this.priceService.getSolPrice();
    return { success: true, data: result };
  }

  /**
   * GET /api/price/token/:mint — 거래 화면 참고가 (최근 체결가 우선, 없으면 오더북 중간값)
   */
  @Get('token/:mint')
  async getTradePrice(@Param('mint') mint: string) {
    const price = await this.priceService.getTradePrice(mint);
    return { success: true, data: { price } };
  }
}
