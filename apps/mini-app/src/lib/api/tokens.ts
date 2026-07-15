import { apiFetch } from './client';

export interface Token {
  id: string;
  mint_address: string;
  symbol: string;
  decimals: number;
  is_active: boolean;
  created_at: string;
}

/**
 * 활성 토큰 목록
 */
export async function getTokens(): Promise<Token[]> {
  return apiFetch('/tokens');
}
