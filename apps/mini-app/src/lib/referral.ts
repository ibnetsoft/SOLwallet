/**
 * 추천 링크 생성 헬퍼
 *
 * 링크 형태:
 * 1. 웹 URL (메인/권장): https://<miniapp>/?ref=<code>
 *    → PC/모바일/일반 브라우저 모두 작동 — 가장 호환성 높음
 *    → Telegram 안에서 열면 자동으로 미니앱 로드 + ?ref= 추천인 추적
 * 2. Telegram 미니앱 딥링크 (보조): https://t.me/<bot>?startapp=<code>
 *    → 모바일 Telegram 전용. PC Desktop은 BOT_INVALID 에러 발생 가능
 *    → (참고) 올바른 Mini App 딥링크는 t.me/<bot>/<app>?startapp= 형식이나
 *      BotFather에 등록된 app name이 필요. 없으면 ?startapp= 폼 사용.
 */

import { getMsg } from '@/lib/i18n';

const TELEGRAM_BOT_USERNAME =
  (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const MINI_APP_URL =
  process.env.NEXT_PUBLIC_MINI_APP_URL || '';

/**
 * 웹 URL 생성 (메인 — 모든 플랫폼 작동)
 */
export function getWebReferralUrl(referralCode: string): string {
  if (!MINI_APP_URL) return '';
  return `${MINI_APP_URL}/?ref=${referralCode}`;
}

/**
 * Telegram 미니앱 딥링크 생성 (보조 — 모바일 전용)
 * ⚠️ PC Telegram Desktop에서는 BOT_INVALID 에러 발생 가능
 */
export function getTelegramDeepLink(referralCode: string): string {
  if (!TELEGRAM_BOT_USERNAME) return '';
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=${referralCode}`;
}

/**
 * 공유용 메인 링크 — 웹 URL 우선, 없으면 딥링크 폴백
 * 클립보드 복사 / 공유 버튼에 사용
 */
export function getShareLink(referralCode: string): string {
  const web = getWebReferralUrl(referralCode);
  if (web) return web;
  return getTelegramDeepLink(referralCode);
}

/**
 * 공유용 텍스트 생성 — 코드 + 링크 포함
 */
export function buildShareText(referralCode: string): string {
  const lines = [
    getMsg('referral.shareTitle'),
    '',
    getMsg('referral.code', { code: referralCode }),
  ];

  const link = getShareLink(referralCode);
  if (link) lines.push('', getMsg('referral.link', { link }));

  return lines.join('\n');
}
