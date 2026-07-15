import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * GET /api/user/profile — 사용자 프로필 조회
   */
  @Get('profile')
  async getProfile(@Req() req: Request) {
    // JwtAuthGuard에서 설정한 user 정보 사용
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    const profile = await this.userService.findById(userId);

    return {
      success: true,
      data: profile,
    };
  }

  /**
   * GET /api/user/wallets — 사용자 지갑 목록 조회
   */
  @Get('wallets')
  async getWallets(@Req() req: Request) {
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    const wallets = await this.userService.getUserWallets(userId);

    return {
      success: true,
      data: wallets,
    };
  }
}
