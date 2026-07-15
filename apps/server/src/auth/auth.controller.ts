import { Controller, Post, Body, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  /**
   * POST /api/auth/telegram
   * Telegram initData 검증 → 사용자 upsert → JWT 발급
   */
  @Post('telegram')
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
}
