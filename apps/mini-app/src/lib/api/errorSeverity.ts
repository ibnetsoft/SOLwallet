import type { ToastVariant } from '@/components/Toast';

/**
 * 서버 에러 code → 클라이언트 toast 심각도 매핑
 *
 * warning (주황): 사용자가 조치하거나 재시도하면 해결되는 에러
 *   - INSUFFICIENT_SOL  : SOL 가스/렌트 부족 → SOL 입금 필요
 *   - MARKET_NOT_READY  : 신규 상장 토큰 → 대기 후 재시도
 *   - TX_EXPIRED        : 블록해시 만료 → 재시도
 *   - SETUP_FAILED      : 거래 준비 실패 → 재시도
 *   - CONFIRM_TIMEOUT   : 체인 컨펌 지연 → 재시도
 *   - TIMEOUT / NETWORK : 일시적 인프라 → 재시도
 *
 * error (빨강): 사용자가 직접 해결하기 어려운 심각한 에러
 *   - 그 외 모든 케이스
 */
const WARNING_CODES = new Set<string>([
  'INSUFFICIENT_SOL',
  'MARKET_NOT_READY',
  'TX_EXPIRED',
  'SETUP_FAILED',
  'CONFIRM_TIMEOUT',
  'TIMEOUT',
  'NETWORK',
  'SIMULATION_FAILED',
  'TX_SUBMIT_FAILED',
  'CANCEL_FAILED',
  'WITHDRAW_FAILED',
  'SWAP_FAILED',
  'WALLET_FAILED',
  'INVALID_INPUT',
  'ORDER_NOT_FOUND',
  'ORDER_INVALID',
  'NOT_FOUND',
  'INSUFFICIENT_BALANCE',
  'TX_BUILD_FAILED',
]);

/**
 * 에러 객체에서 toast variant를 결정한다.
 * ApiError.code가 warning 목록에 있으면 'warning', 그 외는 'error'.
 */
export function getErrorVariant(err: unknown): ToastVariant {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    if (code && WARNING_CODES.has(code)) {
      return 'warning';
    }
  }
  return 'error';
}
