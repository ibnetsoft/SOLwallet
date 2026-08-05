import {
  Controller,
  Get,
  Post,
  Put,
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
import type { ToggleTokenDto, ReorderTokensDto } from '@solwallet/shared-types';
import { BalanceService } from '../balance/balance.service';
import { TransfersService } from '../transfers/transfers.service';
import { OrderStatusService } from '../orders/order-status.service';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly balanceService: BalanceService,
    private readonly transfersService: TransfersService,
    private readonly orderStatusService: OrderStatusService,
  ) {}

  // ─── 대시보드 ───

  @Get('stats')
  async getStats() {
    const stats = await this.adminService.getStats();
    return { success: true, data: stats };
  }

  /**
   * GET /api/admin/dashboard — 통계 + 입금 현황 + 오늘의 가입/트랜잭션
   * ?nocache=1 — 입금 집계 캐시를 무시하고 즉시 재계산 (수동 새로고침용)
   */
  @Get('dashboard')
  async getDashboard(@Query('nocache') nocache?: string) {
    const data = await this.adminService.getDashboard(nocache === '1');
    return { success: true, data };
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

  @Get('users/:userId/balance')
  async getUserBalance(@Param('userId') userId: string) {
    const result = await this.balanceService.getPortfolio(userId);
    return { success: true, data: result };
  }

  /**
   * 유저 일괄 삭제
   * DELETE /api/admin/users  body: { userIds: string[] }
   */
  @Delete('users')
  async deleteUsers(@Body('userIds') userIds: string[]) {
    const result = await this.adminService.deleteUsers(userIds);
    return { success: true, data: result };
  }

  // ─── 추천인 통계 ───

  @Get('referrals/stats')
  async getReferralStats() {
    const stats = await this.adminService.getReferralStats();
    return { success: true, data: stats };
  }

  /**
   * 방장(스폰서) 지정/해제 토글
   * POST /api/admin/users/:id/toggle-sponsor
   */
  @Post('users/:id/toggle-sponsor')
  async toggleSponsor(@Param('id') userId: string) {
    const result = await this.adminService.toggleSponsor(userId);
    return { success: true, data: result };
  }

  /**
   * 어드민이 Tele ID로 스폰서(추천인) 수동 지정
   * PATCH /api/admin/users/:id/sponsor  body: { telegramUid: number }
   */
  @Patch('users/:id/sponsor')
  async setUserSponsor(
    @Param('id') userId: string,
    @Body('sponsor') sponsor?: string,
    @Body('telegramUid') telegramUid?: string | number, // 구버전 클라이언트 호환
  ) {
    const identifier = String(sponsor ?? telegramUid ?? '').trim();
    if (!identifier) {
      throw new BadRequestException('스폰서의 Tele ID를 입력해주세요.');
    }
    const result = await this.adminService.setUserSponsor(userId, identifier);
    return { success: true, data: result };
  }

  /**
   * 어드민 전용 회원 닉네임 저장 (유저 비노출)
   * PATCH /api/admin/users/:id/nickname  body: { nickname: string }
   */
  @Patch('users/:id/nickname')
  async setUserNickname(@Param('id') userId: string, @Body('nickname') nickname: string) {
    const result = await this.adminService.setUserNickname(userId, nickname ?? '');
    return { success: true, data: result };
  }

  // ─── 토큰 관리 ───

  @Get('tokens')
  async getTokens() {
    const tokens = await this.adminService.getTokens();
    return { success: true, data: tokens };
  }

  @Put('tokens/reorder')
  async reorderTokens(@Body() dto: ReorderTokensDto) {
    if (!dto || !dto.order) {
      throw new BadRequestException('order 값이 필요합니다.');
    }
    await this.adminService.reorderTokens(dto.order);
    return { success: true };
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
    @Query('user') user?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const result = await this.adminService.getOrders({
      status,
      tokenId,
      userIdentifier: user,
      sortBy,
      sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
      page,
      pageSize,
    });
    return { success: true, data: result };
  }

  // 과거 주문 복구 — 잘못 분류된 expired/failed 주문을 온체인에서 재조회해 filled로 복구
  @Post('orders/reconcile')
  async reconcileOrders() {
    const result = await this.orderStatusService.reconcilePastOrders();
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

  // ─── 설정 관리 ───

  @Get('settings/fee-rate')
  async getFeeRate() {
    const feeRate = await this.adminService.getFeeRate();
    return { success: true, data: { feeRate } };
  }

  @Patch('settings/fee-rate')
  async updateFeeRate(@Body('feeRate') feeRate: number) {
    const result = await this.adminService.updateFeeRate(Number(feeRate));
    return { success: true, data: result };
  }

  // ─── 입출금 내역 ───

  /** 전체 유저(활성 지갑) 입출금 내역 — 지갑 검색 없이 한 번에 조회 */
  @Get('transfers/all')
  async getAllTransfers(@Query('limit') limit?: string) {
    const items = await this.transfersService.getAllTransfers(
      limit ? parseInt(limit, 10) : 20,
    );
    return { success: true, data: items };
  }

  @Get('transfers')
  async getTransfers(
    @Query('walletAddress') walletAddress: string,
    @Query('limit') limit?: string,
  ) {
    if (!walletAddress) {
      return { success: true, data: [] };
    }
    const items = await this.transfersService.getTransferHistory(
      walletAddress,
      limit ? parseInt(limit, 10) : 50,
    );

    // walletAddress → userId 역조회
    let userId: string | null = null;
    let userName: string | null = null;
    try {
      userId = await this.transfersService.getUserIdByWallet(walletAddress);
      if (userId) {
        userName = await this.transfersService.getUserName(userId);
      }
    } catch {
      // 조회 실패해도 히스토리는 반환
    }

    return { success: true, data: { transfers: items, userId, userName } };
  }
}
