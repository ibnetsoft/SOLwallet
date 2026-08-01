/**
 * 추천 링크 생성 헬퍼
 *
 * 링크 형태:
 * 1. Telegram 미니앱 딥링크 (메인/권장): https://t.me/<bot>?startapp=<code>
 *    → 탭하면 텔레그램이 곧바로 미니앱을 열고 start_param으로 추천코드 전달.
 *      "텔레그램 안에서 열어주세요" 중간 화면 없이 바로 지갑 화면으로 넘어감.
 *    → PC Telegram Desktop에서 드물게 BOT_INVALID 에러 발생 가능하나,
 *      모바일(실사용 대부분)에서는 가장 안정적으로 동작.
 * 2. 웹 URL (보조): https://<miniapp>/?ref=<code>
 *    → 텔레그램이 설치 안 된 환경(PC 브라우저 등)을 위한 폴백.
 *    → 텔레그램 "밖"에서 열면 "Please open this app inside Telegram" 화면을
 *      거쳐야 하므로, 실사용 공유 링크로는 1번(딥링크)을 우선 사용해야 함.
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
 * 공유용 메인 링크 — 텔레그램 딥링크 우선(중간 화면 없이 바로 미니앱 오픈),
 * 봇 username이 설정 안 된 경우에만 웹 URL로 폴백
 * 클립보드 복사 / 공유 버튼에 사용
 */
export function getShareLink(referralCode: string): string {
  const deepLink = getTelegramDeepLink(referralCode);
  if (deepLink) return deepLink;
  return getWebReferralUrl(referralCode);
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
