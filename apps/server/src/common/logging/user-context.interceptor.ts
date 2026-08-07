import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { userContextStorage } from './user-context';

/**
 * 전역 인터셉터 — 각 HTTP 요청의 userId를 AsyncLocalStorage에 저장.
 *
 * JwtAuthGuard가 먼저 실행되어 request.user에 JWT payload를 넣고,
 * 이 인터셉터는 컨트롤러 실행 전후에 context를 설정/해제한다.
 * 인증이 필요 없는 엔드포인트(health, auth 등)는 userId가 undefined.
 *
 * 사용법: main.ts에서 app.useGlobalInterceptors(new UserContextInterceptor())
 */
@Injectable()
export class UserContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: { sub?: string } }>();
    const userId = request.user?.sub;

    return userContextStorage.run({ userId }, () => next.handle());
  }
}
