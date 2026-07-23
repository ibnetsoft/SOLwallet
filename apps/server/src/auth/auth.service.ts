import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, timingSafeEqual } from 'crypto';

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

    // timing-safe comparison (타이밍 공격 방지)
    if (
      computedHash.length !== hash.length ||
      !timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash))
    ) {
      throw new UnauthorizedException('Invalid Telegram auth data.');
    }

    // user 파라미터는 Telegram 스펙상 JSON 문자열임
    // 예: user={"id":123456789,"first_name":"홍길동","username":"gil","last_name":"..."}
    let userObj: { id?: unknown; username?: string; first_name?: string; last_name?: string } = {};
    try {
      userObj = JSON.parse(params.get('user') || '{}');
    } catch {
      throw new UnauthorizedException('Invalid user data in init data.');
    }

    const telegramUid = Number(userObj.id);
    if (!telegramUid || !Number.isFinite(telegramUid)) {
      throw new UnauthorizedException('Invalid user id in init data.');
    }

    const username = userObj.username || '';
    const firstName = userObj.first_name || '';
    const lastName = userObj.last_name || '';

    return { telegramUid, username, firstName, lastName };
  }

  /**
   * JWT 토큰 생성 (일반 유저)
   */
  generateToken(userId: string, telegramUid: number): string {
    return this.jwtService.sign({
      sub: userId,
      telegramUid,
    });
  }

  /**
   * Admin JWT 토큰 생성 — role: 'admin' 포함
   */
  generateAdminToken(): string {
    return this.jwtService.sign({
      sub: 'admin',
      role: 'admin',
    });
  }

  /**
   * Admin secret 검증 — timing-safe comparison 사용
   */
  validateAdminSecret(secret: string): boolean {
    const adminSecret = this.configService.get<string>('ADMIN_SECRET');
    if (!adminSecret) return false;

    // timing-safe comparison으로 타이밍 공격 방지
    try {
      const a = Buffer.from(secret);
      const b = Buffer.from(adminSecret);
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * Dev login secret 검증 — DEV_LOGIN_SECRET이 설정된 경우에만 dev-login 허용
   * timing-safe comparison으로 타이밍 공격 방지
   */
  validateDevSecret(secret: string | undefined): boolean {
    const devSecret = this.configService.get<string>('DEV_LOGIN_SECRET');
    if (!devSecret) return false;

    try {
      const a = Buffer.from(secret || '');
      const b = Buffer.from(devSecret);
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
