import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { UserService } from '../user/user.service';

const MAX_LAUNCH_RETRIES = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf<Context> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {}

  async launchBot(token: string, retries = MAX_LAUNCH_RETRIES): Promise<void> {
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

          // 사용자 등록 (upsert) — 실패해도 환영 메시지는 전송
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

          // 환영 메시지 + 미니앱 버튼 전송 (차단된 유저도 에러 무시)
          try {
            const miniAppUrl = this.configService.get<string>('MINI_APP_URL') || 'https://aoiwallet.com';

            const welcomeMessage = [
              `👋 환영합니다, ${firstName || username}!`,
              '',
              '🔥 **AoiWallet**에 오신 것을 환영합니다.',
              '지정가 매수/매도로 솔라나 토큰을 거래하세요.',
              '',
              '🚀 *토큰 거래하러 가기* → 아래 버튼을 클릭하세요!',
            ].join('\n');

            await ctx.reply(welcomeMessage, {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: '🚀 미니앱 열기',
                      web_app: { url: miniAppUrl },
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
        });

        // /help command
        this.bot.command('help', async (ctx) => {
          await ctx.reply(
            [
              '📖 *도움말*',
              '',
              '/start — 미니앱 열기',
              '/help — 이 도움말 보기',
              '',
              '미니앱에서 지갑을 생성하고 지정가 거래를 시작하세요!',
            ].join('\n'),
            { parse_mode: 'Markdown' },
          );
        });

        // Launch the bot
        await this.bot.launch({ dropPendingUpdates: true });
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
