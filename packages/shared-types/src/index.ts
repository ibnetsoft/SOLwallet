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

export interface AdminUserDetail {
  id: string;
  telegramUid: string;
  username: string;
  firstName: string;
  lastName: string;
  referredBy: string | null;
  walletCount: number;
  createdAt: string;
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
  fee: string;
  status: string;
  txSignature: string | null;
  createdAt: string;
}

// ========================================
// API Response Types
// ========================================

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
