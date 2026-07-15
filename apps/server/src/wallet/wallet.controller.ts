import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../common/interfaces/authenticated-request';
import { IsString, IsOptional, Matches, Length } from 'class-validator';

class RegisterWalletDto {
  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
    message: '올바른 Solana 공개키 형식이 아닙니다.',
  })
  publicKey!: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  label?: string;
}

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * POST /api/wallets/register — public key 등록
   */
  @Post('register')
  async registerWallet(
    @CurrentUser() userId: string,
    @Body() dto: RegisterWalletDto,
  ) {
    const wallet = await this.walletService.registerWallet({
      userId,
      publicKey: dto.publicKey,
      label: dto.label,
    });

    return { success: true, data: wallet };
  }

  /**
   * PATCH /api/wallets/:id/activate — 활성 지갑 전환
   */
  @Patch(':id/activate')
  async activateWallet(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) walletId: string,
  ) {
    const wallet = await this.walletService.setActiveWallet(userId, walletId);
    return { success: true, data: wallet };
  }

  /**
   * DELETE /api/wallets/:id — 지갑 삭제
   */
  @Delete(':id')
  async deleteWallet(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) walletId: string,
  ) {
    await this.walletService.deleteWallet(userId, walletId);
    return { success: true };
  }
}
