/**
 * 추천 링크 생성 헬퍼
 *
 * 두 가지 링크 형태 지원:
 * 1. Telegram 미니앱 딥링크: https://t.me/<bot>?startapp=<code>
 *    → 클릭 시 미니앱이 열리고 start_param으로 코드 자동 전달
 * 2. 일반 웹 URL: https://<miniapp>/?ref=<code>
 *    → Telegram 밖(일반 브라우저, 다른 메신저)에서도 작동
 */

import { getMsg } from '@/lib/i18n';

const TELEGRAM_BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '';
const MINI_APP_URL =
  process.env.NEXT_PUBLIC_MINI_APP_URL || '';

/**
 * Telegram 미니앱 딥링크 생성
 */
export function getTelegramDeepLink(referralCode: string): string {
  if (!TELEGRAM_BOT_USERNAME) return '';
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=${referralCode}`;
}

/**
 * 일반 웹 URL 생성
 */
export function getWebReferralUrl(referralCode: string): string {
  if (!MINI_APP_URL) return '';
  return `${MINI_APP_URL}/?ref=${referralCode}`;
}

/**
 * 공유용 텍스트 생성 — 코드 + 두 링크 모두 포함
 */
export function buildShareText(referralCode: string): string {
  const lines = [
    getMsg('referral.shareTitle'),
    '',
    getMsg('referral.code', { code: referralCode }),
  ];

  const tgLink = getTelegramDeepLink(referralCode);
  const webLink = getWebReferralUrl(referralCode);

  if (tgLink) lines.push('', getMsg('referral.telegram', { link: tgLink }));
  if (webLink) lines.push(getMsg('referral.web', { link: webLink }));

  return lines.join('\n');
}