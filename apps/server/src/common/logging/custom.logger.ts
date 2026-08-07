import { Logger, LogLevel } from '@nestjs/common';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { userContextStorage } from './user-context';

/**
 * NestJS 기본 Logger를 대체하는 커스텀 Logger.
 *
 * - 콘솔(stdout): 기존 NestJS 스타일 텍스트 출력 (docker logs 호환)
 * - 파일: JSON 구조화 로그 → /app/logs/ (Docker 볼륨으로 EC2 호스트에 영속)
 * - userId: AsyncLocalStorage에서 자동 읽어 모든 로그에 포함
 *
 * NestJS의 app.useLogger(new CustomLogger())로 설정하면,
 * 기존 코드의 `new Logger(ClassName)` 호출이 모두 이 클래스로 교체됨.
 */
export class CustomLogger extends Logger {
  private readonly winstonLogger: winston.Logger;

  constructor(context?: string) {
    super(context);

    // 콘솔 출력용 포맷 — NestJS 기본 스타일 유지
    const consoleFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.printf(({ timestamp, level, message, context: ctx, userId }) => {
        const nestLevel = level.toUpperCase().padEnd(5);
        const ctxStr = ctx ? `[${ctx}] ` : '';
        const userStr = userId ? `userId=${userId} ` : '';
        return `[${timestamp}] ${nestLevel} ${ctxStr}${userStr}${message}`;
      }),
    );

    // 파일 출력용 포맷 — JSON 구조화 (jq로 필터링 가능)
    const fileFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    );

    this.winstonLogger = winston.createLogger({
      level: 'info',
      transports: [
        // 콘솔 — docker logs
        new winston.transports.Console({
          format: consoleFormat,
          handleExceptions: true,
        }),
        // 파일 — 일별 로테이션
        new DailyRotateFile({
          dirname: 'logs',
          filename: 'server-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxFiles: '30d',       // 30일 보관
          maxSize: '50m',        // 일별 최대 50MB
          format: fileFormat,
          handleExceptions: true,
        }),
      ],
    });
  }

  /**
   * 현재 AsyncLocalStorage에서 userId를 읽는다.
   * Interceptor가 설정하지 않은 비요청 컨텍스트(부트스트랩, 스케줄러 등)에서는 undefined.
   */
  private getUserId(): string | undefined {
    const store = userContextStorage.getStore();
    return store?.userId;
  }

  private logToWinston(level: string, message: string, context?: string) {
    this.winstonLogger.log({
      level,
      message,
      context: context || this.context,
      userId: this.getUserId(),
    });
  }

  override log(message: unknown, context?: string): void {
    super.log(message, context);
    this.logToWinston('info', String(message), context);
  }

  override error(message: unknown, stack?: string, context?: string): void {
    super.error(message, stack, context);
    // winston 에러 트랜스포트에 stack 포함
    this.winstonLogger.error({
      message: String(message),
      context: context || this.context,
      userId: this.getUserId(),
      stack,
    });
  }

  override warn(message: unknown, context?: string): void {
    super.warn(message, context);
    this.logToWinston('warn', String(message), context);
  }

  override debug(message: unknown, context?: string): void {
    super.debug(message, context);
    this.logToWinston('debug', String(message), context);
  }

  override verbose(message: unknown, context?: string): void {
    super.verbose(message, context);
    this.logToWinston('debug', String(message), context);
  }

  /**
   * NestJS가 기본 Logger 대신 이 클래스를 사용하도록
   * static factory 메서드를 제공.
   */
  static override createLogger(context?: string): CustomLogger {
    return new CustomLogger(context);
  }
}
