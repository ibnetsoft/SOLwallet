import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { UserService } from '../user/user.service';

const MAX_LAUNCH_RETRIES = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

// 지원 언어 목록
type SupportedLocale = 'ko' | 'en' | 'zh' | 'ja';

// 언어별 환영 메시지
const WELCOME_MESSAGES: Record<SupportedLocale, (name: string) => string[]> = {
  ko: (name) => [
    `👋 환영합니다, ${name}!`,
    '',
    '🔥 **AoiWallet**에 오신 것을 환영합니다.',
    '지정가 매수/매도로 솔라나 토큰을 거래하세요.',
    '',
    '🚀 아래 버튼을 눌러 지갑을 열어보세요!',
  ],
  en: (name) => [
    `👋 Welcome, ${name}!`,
    '',
    '🔥 Welcome to **AoiWallet**.',
    'Trade Solana tokens with limit buy/sell orders.',
    '',
    '🚀 Tap the button below to open your wallet!',
  ],
  zh: (name) => [
    `👋 欢迎，${name}！`,
    '',
    '🔥 欢迎使用 **AoiWallet**。',
    '使用限价买入/卖出订单交易 Solana 代币。',
    '',
    '🚀 点击下方按钮打开您的钱包！',
  ],
  ja: (name) => [
    `👋 ようこそ、${name}！`,
    '',
    '🔥 **AoiWallet** へようこそ。',
    '指値注文でソラナトークンを取引しましょう。',
    '',
    '🚀 下のボタンをタップしてウォレットを開いてください！',
  ],
};

// 언어별 미니앱 버튼 텍스트
const OPEN_APP_LABELS: Record<SupportedLocale, string> = {
  ko: '🚀 지갑 열기',
  en: '🚀 Open Wallet',
  zh: '🚀 打开钱包',
  ja: '🚀 ウォレットを開く',
};

// 언어 선택 단계 안내 메시지
const LANG_SELECT_MESSAGES: Record<SupportedLocale, string> = {
  ko: '🌐 언어를 선택해 주세요.',
  en: '🌐 Please select your language.',
  zh: '🌐 请选择您的语言。',
  ja: '🌐 言語を選択してください。',
};

// 초기 언어 선택 메시지 (기본 영어) — /start 시 표시
const INITIAL_LANG_SELECT = '🌐 Please select your language / 언어를 선택해주세요';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf<Context> | null = null;
  private isLaunching = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {}

  async launchBot(token: string, retries = MAX_LAUNCH_RETRIES): Promise<void> {
    if (this.isLaunching) return; // 중복 launch 방지
    this.isLaunching = true;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // 이전 봇 인스턴스 정리
        if (this.bot) {
          try { await this.bot.stop('reconnect'); } catch { /* ignore */ }
          this.bot = null;
        }

        this.bot = new Telegraf(token);

        // /start command handler
        this.bot.start(async (ctx) => {
          const telegramUid = ctx.from?.id;
          const username = ctx.from?.username || '';
          const firstName = ctx.from?.first_name || '';
          const lastName = ctx.from?.last_name || '';
          const startPayload = ctx.startPayload || '';

          this.logger.log(
            `/start received from user: ${username} (${telegramUid}), payload: ${startPayload}`,
          );

          // 사용자 등록 (upsert) — 실패해도 언어 선택 메시지는 전송
          try {
            await this.userService.upsertUser({
              telegramUid: Number(telegramUid),
              username: username || undefined,
              firstName,
              lastName,
              referralCode: startPayload || undefined,
            });
          } catch (error) {
            const msg = error && typeof error === 'object' && 'message' in error
              ? (error as Error).message
              : String(error);
            this.logger.error(`Failed to register user: ${msg}`);
          }

          // 언어 선택 메시지 전송 (기본 영어)
          try {
            await ctx.reply(INITIAL_LANG_SELECT, {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🇰🇷 한국어', callback_data: `lang:ko:${startPayload}` },
                    { text: '🇺🇸 English', callback_data: `lang:en:${startPayload}` },
                  ],
                  [
                    { text: '🇨🇳 中文', callback_data: `lang:zh:${startPayload}` },
                    { text: '🇯🇵 日本語', callback_data: `lang:ja:${startPayload}` },
                  ],
                ],
              },
            });
          } catch (replyError) {
            const msg = replyError && typeof replyError === 'object' && 'message' in replyError
              ? (replyError as Error).message
              : String(replyError);
            this.logger.error(`Failed to send language selection message: ${msg}`);
          }
        });

        // 언어 선택 callback_query 핸들러
        // callback_data 형식: "lang:{locale}:{referralPayload}"
        this.bot.on('callback_query', async (ctx) => {
          const callbackQuery = ctx.callbackQuery;

          // 타입 가드: 텍스트 데이터가 있는 콜백인지 확인
          if (!('data' in callbackQuery)) return;

          const data: string = callbackQuery.data;
          if (!data.startsWith('lang:')) return;

          // callback_query 응답 (로딩 스피너 제거)
          try { await ctx.answerCbQuery(); } catch { /* ignore */ }

          const parts = data.split(':');
          // parts[0] = 'lang', parts[1] = locale, parts[2..] = referralPayload (콜론 포함 가능)
          const locale = parts[1] as SupportedLocale;
          const referralPayload = parts.slice(2).join(':');

          const supportedLocales: SupportedLocale[] = ['ko', 'en', 'zh', 'ja'];
          if (!supportedLocales.includes(locale)) return;

          const firstName = ctx.from?.first_name || ctx.from?.username || 'User';
          const miniAppUrl = this.configService.get<string>('MINI_APP_URL') || 'https://aoiwallet.com';

          // 언어 + 추천코드를 URL에 추가.
          // ⚠️ referralPayload를 빼먹으면 t.me/<bot>?startapp=<코드>로 들어온 신규
          // 가입자의 추천 관계가 전혀 연결되지 않음 — 미니앱은 web_app 버튼의 URL로
          // 열리므로, /start의 startPayload를 여기까지 실어 날라야 함
          const appUrl = referralPayload
            ? `${miniAppUrl}?lang=${locale}&ref=${encodeURIComponent(referralPayload)}`
            : `${miniAppUrl}?lang=${locale}`;

          const welcomeLines = WELCOME_MESSAGES[locale](firstName);
          const welcomeText = welcomeLines.join('\n');
          const buttonLabel = OPEN_APP_LABELS[locale];

          try {
            // 기존 언어 선택 메시지를 환영 메시지로 교체
            await ctx.editMessageText(welcomeText, {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: buttonLabel,
                      web_app: { url: appUrl },
                    },
                  ],
                ],
              },
            });
          } catch (editError) {
            // editMessageText 실패 시 새 메시지로 전송 (fallback)
            try {
              await ctx.reply(welcomeText, {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: buttonLabel,
                        web_app: { url: appUrl },
                      },
                    ],
                  ],
                },
              });
            } catch (replyError) {
              const msg = replyError && typeof replyError === 'object' && 'message' in replyError
                ? (replyError as Error).message
                : String(replyError);
              this.logger.error(`Failed to send welcome message: ${msg}`);
            }
          }
        });

        // /help command
        this.bot.command('help', async (ctx) => {
          await ctx.reply(
            [
              '📖 *Help*',
              '',
              '/start — Open wallet',
              '/help — Show this help',
              '',
              '🌐 Language is selected when you start the bot.',
            ].join('\n'),
            { parse_mode: 'Markdown' },
          );
        });

        // Launch the bot
        // NOTE: Telegraf 4.x의 launch()는 내부에서 무한 폴링 루프에 빠지므로
        // resolve하지 않음. 성공 여부는 bot.launch() 호출 전에 getMe/deleteWebhook으로
        // Telegram API 연결을 먼저 검증하고, launch()는 fire-and-forget으로 실행.
        this.logger.log(`🔄 Telegram bot launch attempt ${attempt}/${retries}...`);

        // 사전 검증: API 연결 + webhook 정리
        await this.bot.telegram.getMe();
        await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });

        // launch()는 fire-and-forget — resolve하지 않으므로 await 불가
        this.bot
          .launch({ dropPendingUpdates: true })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Bot polling error: ${msg}`);
          });

        this.logger.log('✅ Telegram bot launched successfully');

        // Graceful shutdown
        process.once('SIGINT', () => this.bot?.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot?.stop('SIGTERM'));

        return; // 성공 — 루프 종료
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);

        if (msg.includes('409') && attempt < retries) {
          this.logger.warn(
            `⚠️ Telegram bot launch 409 Conflict (attempt ${attempt}/${retries}). Retrying in ${LAUNCH_RETRY_DELAY_MS / 1000}s...`,
          );
          await new Promise((r) => setTimeout(r, LAUNCH_RETRY_DELAY_MS));
          continue;
        }

        this.logger.error(`Failed to launch Telegram bot: ${msg} (after ${attempt} attempts)`);
        throw error;
      }
    }
  }
}
