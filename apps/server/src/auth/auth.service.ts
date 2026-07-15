import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Telegram initData 검증
   * Telegram WebApp에서 전달받은 initData의 서명을 검증합니다.
   */
  validateTelegramAuth(initData: string): {
    telegramUid: number;
    username: string;
    firstName: string;
    lastName: string;
  } {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new UnauthorizedException('Bot token is not configured.');
    }

    // initData를 '&'로 분리하여 파싱
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      throw new UnauthorizedException('Invalid init data: no hash.');
    }

    // hash 제거한 나머지를 알파벳순 정렬
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // HMAC-SHA256 서명 검증
    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const computedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computedHash !== hash) {
      throw new UnauthorizedException('Invalid Telegram auth data.');
    }

    const telegramUid = parseInt(params.get('user') || '0', 10);
    const username = params.get('username') || '';
    const firstName = params.get('first_name') || '';
    const lastName = params.get('last_name') || '';

    if (!telegramUid) {
      throw new UnauthorizedException('Invalid user id in init data.');
    }

    return { telegramUid, username, firstName, lastName };
  }

  /**
   * JWT 토큰 생성
   */
  generateToken(userId: string, telegramUid: number): string {
    return this.jwtService.sign({
      sub: userId,
      telegramUid,
    });
  }

  /**
   * Admin JWT 토큰 생성
   * ADMIN_SECRET이 일치하면 role: 'admin' JWT 발급
   */
  generateAdminToken(secret: string): string {
    return this.jwtService.sign({
      sub: 'admin',
      role: 'admin',
    });
  }

  /**
   * Admin secret 검증
   */
  validateAdminSecret(secret: string): boolean {
    const adminSecret = this.configService.get<string>('ADMIN_SECRET');
    return !!adminSecret && secret === adminSecret;
  }
}
