import { Body, Controller, Logger, Post } from '@nestjs/common';

interface ClientErrorDto {
  message?: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  digest?: string;
}

/**
 * POST /client-error — 클라이언트(브라우저) 크래시 리포트 수신 (/api 프리픽스 제외, 인증 불필요)
 *
 * mini-app에는 크래시를 볼 방법이 서버 로그밖에 없었다(Sentry 등 미도입).
 * app/error.tsx, app/global-error.tsx가 잡은 에러를 여기로 보내 docker logs에서 바로 확인한다.
 */
@Controller('client-error')
export class ClientErrorController {
  private readonly logger = new Logger('ClientError');

  @Post()
  report(@Body() body: ClientErrorDto) {
    this.logger.error(
      `[client crash] url=${body.url ?? '?'} msg=${body.message ?? '?'} ua=${body.userAgent ?? '?'}\n${body.stack ?? '(no stack)'}`,
    );
    return { ok: true };
  }
}
