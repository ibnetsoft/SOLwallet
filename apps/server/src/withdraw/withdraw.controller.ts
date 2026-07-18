import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { IsString, IsNumber, Min, Matches, IsUUID } from 'class-validator';
import { WithdrawService } from './withdraw.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../common/interfaces/authenticated-request';

class SubmitWithdrawDto {
  @IsUUID()
  walletId!: string;

  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
    message: '올바른 Solana 주소 형식이 아닙니다.',
  })
  toAddress!: string;

  @IsString()
  mint!: string;

  @IsNumber()
  @Min(0.000001, { message: '수량은 0보다 커야 합니다.' })
  amount!: number;

  @IsString()
  signedTx!: string;
}

@Controller('withdraw')
@UseGuards(JwtAuthGuard)
export class WithdrawController {
  constructor(private readonly withdrawService: WithdrawService) {}

  /**
   * POST /api/withdraw — 출금 (서명된 트랜잭션 제출)
   */
  @Post()
  async submitWithdraw(
    @CurrentUser() userId: string,
    @Body() dto: SubmitWithdrawDto,
  ) {
    const result = await this.withdrawService.submitWithdraw(userId, dto);
    return { success: true, data: result };
  }
}
