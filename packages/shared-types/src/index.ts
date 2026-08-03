// ========================================
// User & Auth Types
// ========================================

export interface User {
  id: string;
  telegramUid: string;
  username: string;
  firstName?: string;
  lastName?: string;
  referredBy?: string;
  referralCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

// ========================================
// Wallet Types
// ========================================

export interface Wallet {
  id: string;
  userId: string;
  publicKey: string;
  walletIndex: number;
  label: string;
  isActive: boolean;
  createdAt: string;
}

// ========================================
// Token Types
// ========================================

export interface Token {
  id: string;
  mintAddress: string;
  symbol: string;
  decimals: number;
  isActive: boolean;
  createdAt: string;
}

// ========================================
// Order Types
// ========================================

export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'active' | 'filled' | 'cancelled' | 'expired';

export interface Order {
  id: string;
  userId: string;
  walletId: string;
  tokenId: string;
  side: OrderSide;
  orderType: 'limit';
  price: number;
  quantity: number;
  filledQty: number;
  fee: number;
  feeRate: number;
  status: OrderStatus;
  txSignature?: string;
  manifestOrderId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderDto {
  tokenId: string;
  side: OrderSide;
  price: number;
  quantity: number;
}

// ========================================
// Referral Types
// ========================================

export interface Referral {
  id: string;
  referrerId: string;
  refereeId: string;
  createdAt: string;
}

// ========================================
// Balance & Portfolio Types
// ========================================

export interface TokenBalance {
  token: Token;
  quantity: number;
  valueUsdt: number;
}

export interface Portfolio {
  totalValueUsdt: number;
  roi: number;
  pnl: number;
  holdings: TokenBalance[];
}

// ========================================
// Orderbook Types
// ========================================

export interface OrderbookEntry {
  price: number;
  quantity: number;
}

export interface Orderbook {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  spread?: number;
}

// ========================================
// Admin Types
// ========================================

export interface AdminStats {
  totalUsers: number;
  todaySignups: number;
  totalFeeRevenue: number;
  totalOrders: number;
  activeOrders: number;
}

/** 대시보드 — 오늘 가입한 회원 (회원목록과 동일한 필드 일부) */
export interface DashboardTodayUser {
  id: string;
  telegramUid: string | number;
  username: string;
  firstName: string;
  createdAt: string;
  referralCode: string | null;
  sponsorTeleId: string | null;
  adminNickname: string | null;
}

/** 대시보드 — 오늘의 트랜잭션(주문) */
export interface DashboardTodayOrder {
  id: string;
  createdAt: string;
  username: string;
  side: string;
  tokenSymbol: string;
  price: string | number;
  quantity: string | number;
  fee: string | number;
  status: string;
  txSignature: string | null;
}

/** 대시보드 — 오늘의 입출금 내역 (온체인 실시간 조회) */
export interface DashboardTodayTransfer {
  id: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  tokenSymbol: string;
  status: string;
  createdAt: string;
  sender: string;
  receiver: string;
  userId: string;
  userName: string;
  walletAddress: string;
}

/**
 * 대시보드 전체 데이터 — 기존 통계 + 입금 현황 + 오늘의 목록
 *
 * ⚠️ 입금 관련 값은 온체인에서 직접 집계함 (transfers 테이블에는 출금만
 * 기록되고 입금은 남지 않기 때문). RPC 부하를 줄이려 서버에서 캐시함.
 */
export interface AdminDashboard extends AdminStats {
  /** 전체 회원 지갑의 현재 보유 잔고 합계 (USDT 환산) */
  totalDepositUsdt: number;
  /** 오늘 입금된 금액 (USDT 환산) */
  todayDepositUsdt: number;
  /** 입금 집계가 RPC 오류 등으로 부분적으로만 성공했는지 여부 */
  depositStatsPartial: boolean;
  todayUsers: DashboardTodayUser[];
  todayOrders: DashboardTodayOrder[];
  todayTransfers: DashboardTodayTransfer[];
}

export interface AdminUserDetail {
  id: string;
  telegramUid: string | number;
  username: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  lastLoginAt: string;
  referralCode: string | null;
  referrerCode: string | null;
  sponsorTeleId: string | null;
  level1Referrals: number;
  level2Referrals: number;
  level3Referrals: number;
  level4Referrals: number;
  level5Referrals: number;
  totalReferrals: number;
  walletCount: number;
  adminNickname: string | null;
}

export interface AdminTokenDetail {
  id: string;
  mintAddress: string;
  symbol: string;
  decimals: number;
  isActive: boolean;
  logoUrl?: string | null;
  createdAt: string;
}

export interface AdminOrderDetail {
  id: string;
  userId: string;
  username: string;
  tokenSymbol: string;
  side: string;
  price: string;
  quantity: string;
  /** 체결된 수량 (부분 체결 표시용) */
  filledQty: string | number;
  fee: string;
  status: string;
  /** 주문 등록 트랜잭션 */
  txSignature: string | null;
  /** 취소 트랜잭션 — 주문 tx와 별개로 보관 (덮어쓰지 않음) */
  cancelTxSignature: string | null;
  createdAt: string;
  updatedAt: string | null;
  /** 어느 단계에서 멈췄는지 사람이 읽을 수 있게 풀어쓴 상태 설명 */
  statusMessage: string;
}

// ========================================
// API Response Types
// ========================================

export interface ToggleTokenDto {
  isActive: boolean;
}

export interface ReorderTokensDto {
  order: { [tokenId: string]: number };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ========================================
// Referral Tree Types
// ========================================

export interface ReferralTreeNode {
  id: string;
  username: string | null;
  firstName: string;
  telegramUid: number;
  referralCode: string | null;
  depth: number;
  createdAt: string;
  childrenCount: number;
  children: ReferralTreeNode[];
}

export interface ReferralAncestor {
  id: string;
  username: string | null;
  firstName: string;
  referralCode: string | null;
  depth: number;
}

export interface ReferralRoot {
  id: string;
  username: string | null;
  firstName: string;
  telegramUid: number;
  referralCode: string | null;
  directCount: number;
  createdAt: string;
}

export interface ReferralTreeResponse {
  tree: ReferralTreeNode;
  ancestors: ReferralAncestor[];
  stats: {
    totalNodes: number;
    maxDepth: number;
    perLevelCounts: Record<number, number>;
  };
}
