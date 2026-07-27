import {
  Controller,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SwapService } from './swap.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../common/interfaces/authenticated-request';
import {
  SwapQuoteDto,
  SwapExecuteDto,
} from '../common/dto/swap.dto';

@Controller('swap')
@UseGuards(JwtAuthGuard)
export class SwapController {
  constructor(private readonly swapService: SwapService) {}

  /**
   * POST /api/swap/quote — Jupiter 견적 + unsigned tx 반환
   */
  @Post('quote')
  async getQuote(
    @CurrentUser() userId: string,
    @Body() dto: SwapQuoteDto,
  ) {
    const result = await this.swapService.getQuote(
      userId,
      dto.walletId,
      dto.inputMint,
      dto.outputMint,
      dto.amount,
      dto.slippageBps,
    );
    return { success: true, data: result };
  }

  /**
   * POST /api/swap/execute — 서명된 스왑 tx 제출
   */
  @Post('execute')
  async execute(
    @CurrentUser() userId: string,
    @Body() dto: SwapExecuteDto,
  ) {
    const result = await this.swapService.executeSwap(userId, dto.signedTx);
    return { success: true, data: result };
  }
}
