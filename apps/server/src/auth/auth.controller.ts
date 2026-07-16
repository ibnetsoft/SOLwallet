import { Controller, Post, Body, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle, SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';

@Controller('auth')
@UseGuards(ThrottlerGuard)
@SkipThrottle() // 기본적으로 건너뛰기 — 개별 엔드포인트에서 명시적 설정
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  /**
   * POST /api/auth/telegram
   * Telegram initData 검증 → 사용자 upsert → JWT 발급
   * Rate limit: 10회/분 (무차별 대입 방지)
   */
  @Post('telegram')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async telegramAuth(@Body() body: { initData: string }) {
    if (!body.initData) {
      throw new UnauthorizedException('initData is required.');
    }

    // Telegram 서명 검증
    const authData = this.authService.validateTelegramAuth(body.initData);

    // 사용자 upsert (없으면 생성, 있으면 업데이트)
    const user = await this.userService.upsertUser({
      telegramUid: authData.telegramUid,
      username: authData.username,
      firstName: authData.firstName,
      lastName: authData.lastName,
    });

    // JWT 발급
    const token = this.authService.generateToken(
      user.id,
      authData.telegramUid,
    );

    return {
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          telegram_uid: user.telegram_uid,
          username: user.username,
          first_name: user.first_name,
        },
      },
    };
  }

  /**
   * POST /api/auth/admin
   * Admin secret 검증 → Admin JWT 발급
   * Rate limit: 5회/분 (타이밍 공격 + 브루트포스 방지)
   */
  @Post('admin')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async adminAuth(@Body() body: { secret: string }) {
    if (!body.secret) {
      throw new UnauthorizedException('Admin secret is required.');
    }

    const isValid = this.authService.validateAdminSecret(body.secret);
    if (!isValid) {
      throw new UnauthorizedException('유효하지 않은 관리자 비밀키입니다.');
    }

    const token = this.authService.generateAdminToken();

    return {
      success: true,
      data: { token },
    };
  }
}
