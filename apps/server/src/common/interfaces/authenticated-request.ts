import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtPayload {
  sub: string;
  telegramUid?: number;
  role?: string;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/**
 * @CurrentUser() — JWT에서 추출한 유저 ID를 주입
 * 사용법: async handler(@CurrentUser() userId: string)
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.sub;
  },
);
