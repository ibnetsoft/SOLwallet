import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly supabaseService: SupabaseService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('인증 토큰이 필요합니다.');
    }

    const token = authHeader.split(' ')[1];

    let payload: { sub: string; telegramUid?: number; role?: string };
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }

    // 토큰은 유효하지만 그 사이 유저가 삭제된 경우(어드민이 회원 삭제 등) 차단.
    // 이걸 안 걸러내면 이후 지갑 등록 등에서 FK 위반으로 500 에러가 발생함.
    const { data: user, error } = await this.supabaseService
      .getClient()
      .from('users')
      .select('id')
      .eq('id', payload.sub)
      .maybeSingle();

    if (error || !user) {
      this.logger.warn(`Token references non-existent user: ${payload.sub}`);
      throw new UnauthorizedException('계정을 찾을 수 없습니다. 다시 로그인해주세요.');
    }

    request.user = payload;
    return true;
  }
}
