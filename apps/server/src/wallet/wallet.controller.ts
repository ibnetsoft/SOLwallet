import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * POST /api/wallets/register — public key 등록
   */
  @Post('register')
  async registerWallet(
    @Req() req: Request,
    @Body() body: { publicKey: string; label?: string },
  ) {
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    const wallet = await this.walletService.registerWallet({
      userId,
      publicKey: body.publicKey,
      label: body.label,
    });

    return {
      success: true,
      data: wallet,
    };
  }

  /**
   * PATCH /api/wallets/:id/activate — 활성 지갑 전환
   */
  @Patch(':id/activate')
  async activateWallet(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) walletId: string,
  ) {
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    const wallet = await this.walletService.setActiveWallet(userId, walletId);

    return {
      success: true,
      data: wallet,
    };
  }

  /**
   * DELETE /api/wallets/:id — 지갑 삭제
   */
  @Delete(':id')
  async deleteWallet(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) walletId: string,
  ) {
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    await this.walletService.deleteWallet(userId, walletId);

    return {
      success: true,
    };
  }
}
