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
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  /**
   * 토큰 로고 업로드 — multipart/form-data
   * 필드: file (PNG 이미지), symbol (심볼)
   * 저장 규칙: token-logos/{symbol-lowercase}.png
   * 응답: { success, data: { logoUrl } }
   */
  @Post('tokens/logo')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB 제한
    fileFilter: (_req, file, cb) => {
      if (!/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) {
        return cb(new BadRequestException('PNG/JPG/WebP 이미지만 업로드 가능합니다.'), false);
      }
      cb(null, true);
    },
  }))
  async uploadTokenLogo(
    @UploadedFile() file: Express.Multer.File,
    @Body('symbol') symbol: string,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('파일이 누락되었습니다.');
    }
    if (!symbol) {
      throw new BadRequestException('심볼이 누락되었습니다.');
    }
    const logoUrl = await this.adminService.uploadTokenLogo(symbol, file.buffer);
    return { success: true, data: { logoUrl } };
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

  // ─── 추천 조직도 ───

  @Get('referrals/tree')
  async getReferralTree(
    @Query('userId') userId: string,
    @Query('maxDepth', new DefaultValuePipe(5), ParseIntPipe) maxDepth: number,
  ) {
    if (!userId) throw new BadRequestException('userId is required');
    const result = await this.adminService.getReferralTree(userId, maxDepth);
    return { success: true, data: result };
  }

  @Get('referrals/roots')
  async getReferralRoots() {
    const roots = await this.adminService.getReferralRoots();
    return { success: true, data: roots };
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
