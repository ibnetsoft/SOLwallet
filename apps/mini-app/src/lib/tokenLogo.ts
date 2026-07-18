/**
 * 토큰 로고 이미지 URL 헬퍼
 * 규칙: Supabase Storage token-logos/{symbol-lowercase}.png
 */

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://yvnxbalfktdxhlcbftax.supabase.co';
const BUCKET = 'token-logos';

/**
 * 토큰 심볼로 로고 URL 생성
 * 파일이 Storage에 없으면 404 → onError에서 fallback 처리
 */
export function getTokenLogoUrl(symbol: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${symbol.toLowerCase()}.png`;
}
