import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';

/**
 * Admin 전용 Guard — 기존 JwtAuthGuard와 동일 JWT 검증 방식
 * Admin 로그인 시 발급된 JWT 토큰으로만 접근 가능
 */
@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
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

    try {
      const payload = this.jwtService.verify(token);
      // Admin 토큰에는 role: 'admin'이 포함됨
      if (payload.role !== 'admin') {
        throw new UnauthorizedException('관리자 권한이 없습니다.');
      }
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }
  }
}
