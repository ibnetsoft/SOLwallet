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
 * 에러 코드를 포함하는 예외 — 클라이언트가 심각도를 판별할 수 있게 함.
 *
 * code는 머신 리더블 식별자:
 *   INSUFFICIENT_SOL  — SOL 가스/렌트 부족 (사용자 조치 가능 → 주황 토스트)
 *   MARKET_NOT_READY  — 신규 상장 토큰 (재시도 가능 → 주황 토스트)
 *   TX_EXPIRED        — 블록해시 만료 (재시도 가능 → 주황 토스트)
 *   SETUP_FAILED      — 거래 준비 실패 (재시도 가능 → 주황 토스트)
 *   CONFIRM_TIMEOUT   — 컨펌 지연 (재시도 가능 → 주황 토스트)
 *   (생략)            — 일반 실패 (심각 → 빨간 토스트)
 */
export class CodedException extends HttpException {
  code: string;

  constructor(message: string, code: string, status = HttpStatus.BAD_REQUEST) {
    super({ message, code }, status);
    this.code = code;
  }
}

/**
 * RPC 에러 메시지를 분석해서 원인별 CodedException으로 변환.
 * "트랜잭션 제출에 실패했습니다" 같은 제네릭 메시지 대신,
 * 사용자가 조치 가능한 구체적 안내를 제공.
 *
 * 항상 throw되지 않고 CodedException을 반환하므로 호출자가 throw해야 함.
 * RPC 에러가 아니면 null을 반환.
 */
export function parseRpcError(errMsg: string): CodedException | null {
  if (!errMsg) return null;

  // SOL 잔고/렌트 부족
  if (errMsg.includes('InsufficientFundsForRent') || errMsg.includes('insufficient lamports')) {
    return new CodedException(
      'SOL 잔고가 부족하여 트랜잭션 수수료를 낼 수 없습니다.\nSOL을 입금한 후 다시 시도해주세요.',
      'INSUFFICIENT_SOL',
    );
  }

  // 블록해시 만료
  if (errMsg.includes('blockhash') || errMsg.includes('Blockhash not found') || errMsg.includes('Transaction expired')) {
    return new CodedException(
      '트랜잭션 블록해시가 만료되었습니다. 다시 시도해주세요.',
      'TX_EXPIRED',
    );
  }

  // 시뮬레이션 실패 — 원인별 친절한 메시지 (기술적 RPC 디테일 노출 금지)
  if (errMsg.includes('Transaction simulation failed')) {
    // 토큰 잔액 부족 (TokenkegQfeQ..., System program)
    if (/insufficient funds/i.test(errMsg)) {
      return new CodedException(
        '토큰 잔액이 부족하여 주문을 실행할 수 없습니다.\n지갑 잔액을 확인 후 다시 시도해주세요.',
        'INSUFFICIENT_TOKEN_BALANCE',
      );
    }
    // 프로그램 에러 — 0x1 (미국법 위반 불충분펀드 등) / 0x0 (일반 실패)
    if (/custom program error:\s*0x[0-9a-fA-F]+/i.test(errMsg)) {
      return new CodedException(
        '거래를 처리하는 중 오류가 발생했습니다.\n잔액이나 거래 조건을 확인 후 다시 시도해주세요.',
        'SIMULATION_FAILED',
      );
    }
    // InstructionError (계산 오버플로우, 잘못된 계정 등)
    if (/InstructionError/i.test(errMsg)) {
      return new CodedException(
        '거래 명령 처리에 실패했습니다.\n잠시 후 다시 시도해주세요.',
        'SIMULATION_FAILED',
      );
    }
    // 계정 불일치 또는 권한 문제
    if (/invalid account|AccountNotInitialized|seeds must match|ConstraintSeeds/i.test(errMsg)) {
      return new CodedException(
        '거래 계정 설정에 문제가 있습니다.\n잠시 후 다시 시도해주세요.',
        'SETUP_FAILED',
      );
    }
    // 기타 시뮬레이션 실패 — 상세 로그는 서버에만 기록
    return new CodedException(
      '거래 시뮬레이션에 실패했습니다.\n잔액이나 거래 조건을 확인 후 다시 시도해주세요.',
      'SIMULATION_FAILED',
    );
  }

  // 계정 존재하지 않음 / 데이터 덮어쓰기
  if (errMsg.includes('account not found') || errMsg.includes('AccountNotFound')) {
    return new CodedException(
      '필요한 계정이 체인에 존재하지 않습니다. 잠시 후 다시 시도해주세요.',
      'SETUP_FAILED',
    );
  }

  // 프리플라이트 실패
  if (errMsg.includes('preflight') || errMsg.includes('PreflightFailure')) {
    return new CodedException(
      '거래 사전 검증에 실패했습니다.\n잔액이나 거래 조건을 확인 후 다시 시도해주세요.',
      'SIMULATION_FAILED',
    );
  }

  return null;
}

/**
 * 전역 예외 필터 — 일관된 에러 응답 형식 유지
 * { success: false, error: "메시지", code: "ERROR_CODE", statusCode: 400 }
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
    let code: string | undefined;

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
        // CodedException의 code 필드 추출
        if (typeof resObj.code === 'string') {
          code = resObj.code;
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
      code,
      message,
      statusCode,
    });
  }
}
