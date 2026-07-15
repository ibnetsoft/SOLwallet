import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../common/interfaces/authenticated-request';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * GET /api/user/profile — 사용자 프로필 + 추천인 정보
   */
  @Get('profile')
  async getProfile(@CurrentUser() userId: string) {
    const profile = await this.userService.getUserProfile(userId);
    return { success: true, data: profile };
  }

  /**
   * GET /api/user/wallets — 사용자 지갑 목록 조회
   */
  @Get('wallets')
  async getWallets(@CurrentUser() userId: string) {
    const wallets = await this.userService.getUserWallets(userId);
    return { success: true, data: wallets };
  }
}
