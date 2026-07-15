// ========================================
// DEX MINER BOT — Shared Configuration
// ========================================

/** 거래 수수료율 */
export const FEE_RATE = 0.01; // 1%

/** 최대 지갑 수 */
export const MAX_WALLETS = 3;

/** 기본 기축 통화 */
export const BASE_CURRENCY = 'USDT';

/** 주문 타입 (지정가만 지원) */
export const ORDER_TYPE = 'limit' as const;

/** 빠른 수량 비율 버튼 */
export const QUICK_AMOUNT_RATIOS = [0.25, 0.5, 0.75, 1.0] as const;

/** Solana 네트워크 */
export const SOLANA_NETWORK = {
  devnet: 'devnet' as const,
  mainnet: 'mainnet-beta' as const,
} as const;

/** RPC 엔드포인트 기본값 */
export const DEFAULT_RPC = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
} as const;

/** JWT 토큰 만료 시간 */
export const JWT_EXPIRES_IN = '7d';

/** 지갑 암호화 설정 */
export const WALLET_ENCRYPTION = {
  algorithm: 'AES-256-GCM' as const,
  keyDerivation: 'PBKDF2' as const,
  iterations: 600000, // OWASP 2023 권장 최소값 (PBKDF2-SHA-256)
  keyLength: 256,
} as const;

/** PIN 설정 — 최소 자릿수 */
export const PIN_MIN_LENGTH = 6;

/** 자동 잠금 타임아웃 (ms) — 5분 */
export const AUTO_LOCK_TIMEOUT = 5 * 60 * 1000;

/** Manifest.trade API 설정 (공개 API — API Key 불필요) */
export const MANIFEST = {
  /** Base URL */
  baseUrl: 'https://manifest-orders.fly.dev/v1',
  /** 엔드포인트 */
  endpoints: {
    createOrder: '/orders',
    getOrders: '/orders',
    cancelOrder: '/orders',
  } as const,
} as const;
