import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── 대시보드 ───

  /**
   * GET /api/admin/stats — 대시보드 통계
   */
  @Get('stats')
  async getStats() {
    const stats = await this.adminService.getStats();
    return { success: true, data: stats };
  }

  // ─── 유저 관리 ───

  /**
   * GET /api/admin/users — 유저 목록
   */
  @Get('users')
  async getUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    const result = await this.adminService.getUsers(page, pageSize);
    return { success: true, data: result };
  }

  /**
   * GET /api/admin/users/:id/wallets — 특정 유저 지갑
   */
  @Get('users/:id/wallets')
  async getUserWallets(@Param('id') userId: string) {
    const wallets = await this.adminService.getUserWallets(userId);
    return { success: true, data: wallets };
  }

  // ─── 토큰 관리 ───

  /**
   * GET /api/admin/tokens — 토큰 목록
   */
  @Get('tokens')
  async getTokens() {
    const tokens = await this.adminService.getTokens();
    return { success: true, data: tokens };
  }

  /**
   * POST /api/admin/tokens — 토큰 등록
   */
  @Post('tokens')
  async createToken(
    @Body() body: { mintAddress: string; symbol: string; decimals: number },
  ) {
    const token = await this.adminService.createToken(body);
    return { success: true, data: token };
  }

  /**
   * PATCH /api/admin/tokens/:id — 토큰 활성화/비활성화
   */
  @Patch('tokens/:id')
  async toggleToken(@Param('id') tokenId: string) {
    const token = await this.adminService.toggleToken(tokenId);
    return { success: true, data: token };
  }

  // ─── 주문 관리 ───

  /**
   * GET /api/admin/orders — 전체 주문 내역
   */
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
}
