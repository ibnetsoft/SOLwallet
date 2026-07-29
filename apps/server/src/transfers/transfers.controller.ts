import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getTransfers(
    @Query('walletAddress') walletAddress: string,
    @Query('limit') limit?: string,
  ) {
    if (!walletAddress) {
      return { success: true, data: [] };
    }
    const items = await this.transfersService.getTransferHistory(
      walletAddress,
      limit ? parseInt(limit, 10) : 20,
    );
    return { success: true, data: items };
  }
}
