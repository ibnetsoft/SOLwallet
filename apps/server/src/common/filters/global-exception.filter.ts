import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * 전역 예외 필터 — 일관된 에러 응답 형식 유지
 * { success: false, error: "메시지", statusCode: 400 }
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '서버 내부 오류가 발생했습니다.';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        // class-validator 에러 (배열 형태의 message)
        if (Array.isArray(resObj.message)) {
          message = (resObj.message as string[]).join(', ');
        } else if (typeof resObj.message === 'string') {
          message = resObj.message;
        }
        if (typeof resObj.error === 'string') {
          error = resObj.error;
        }
      }
    } else {
      // 예상치 못한 에러 — 상세 로그만, 클라이언트에는 일반 메시지
      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json({
      success: false,
      error,
      message,
      statusCode,
    });
  }
}
