import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';

/**
 * Admin 전용 Guard — Admin JWT 토큰 검증 + role 체크
 */
@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly jwtService: JwtService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('인증 토큰이 필요합니다.');
    }

    const token = authHeader.split(' ')[1];

    let payload: { sub: string; role?: string };

    // 1단계: JWT 서명 검증
    try {
      payload = this.jwtService.verify(token);
    } catch (err) {
      this.logger.debug(`JWT verification failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }

    // 2단계: role 검증 (try/catch 밖에서 별도 처리)
    if (payload.role !== 'admin') {
      this.logger.warn(`Non-admin token attempted admin access: sub=${payload.sub}`);
      throw new UnauthorizedException('관리자 권한이 없습니다.');
    }

    request.user = payload;
    return true;
  }
}
