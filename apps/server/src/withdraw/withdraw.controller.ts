import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
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
   * GET /api/withdraw/check-address — 수신 주소가 새 계정인지 확인
   */
  @Get('check-address')
  async checkAddress(
    @Query('address') address: string,
  ) {
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return { success: true, data: { isNewAccount: false, minWithdraw: 0 } };
    }
    const result = await this.withdrawService.checkAddress(address);
    return { success: true, data: result };
  }

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
