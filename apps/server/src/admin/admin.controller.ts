import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { CreateTokenDto } from '../common/dto/token.dto';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── 대시보드 ───

  @Get('stats')
  async getStats() {
    const stats = await this.adminService.getStats();
    return { success: true, data: stats };
  }

  // ─── 유저 관리 ───

  @Get('users')
  async getUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    const result = await this.adminService.getUsers(page, pageSize);
    return { success: true, data: result };
  }

  @Get('users/:id/wallets')
  async getUserWallets(@Param('id') userId: string) {
    const wallets = await this.adminService.getUserWallets(userId);
    return { success: true, data: wallets };
  }

  // ─── 추천인 통계 ───

  @Get('referrals/stats')
  async getReferralStats() {
    const stats = await this.adminService.getReferralStats();
    return { success: true, data: stats };
  }

  // ─── 토큰 관리 ───

  @Get('tokens')
  async getTokens() {
    const tokens = await this.adminService.getTokens();
    return { success: true, data: tokens };
  }

  @Post('tokens')
  async createToken(@Body() dto: CreateTokenDto) {
    const token = await this.adminService.createToken(dto);
    return { success: true, data: token };
  }

  @Patch('tokens/:id')
  async toggleToken(@Param('id') tokenId: string) {
    const token = await this.adminService.toggleToken(tokenId);
    return { success: true, data: token };
  }

  @Delete('tokens/:id')
  async deleteToken(@Param('id') tokenId: string) {
    const result = await this.adminService.deleteToken(tokenId);
    return { success: true, data: result };
  }

  // ─── 주문 관리 ───

  @Get('orders')
  async getOrders(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Query('status') status?: string,
    @Query('tokenId') tokenId?: string,
  ) {
    const result = await this.adminService.getOrders({ status, tokenId, page, pageSize });
    return { success: true, data: result };
  }

  // ─── 수수료 대장 ───

  @Get('revenue')
  async getRevenue(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
  ) {
    const result = await this.adminService.getRevenueLedger(page, pageSize);
    return { success: true, data: result };
  }
}
