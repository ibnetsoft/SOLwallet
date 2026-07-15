import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf<Context> | null = null;

  constructor(private readonly configService: ConfigService) {}

  async launchBot(token: string) {
    try {
      this.bot = new Telegraf(token);

      // /start command handler
      this.bot.start(async (ctx) => {
        const telegramUid = ctx.from?.id?.toString();
        const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
        const startPayload = ctx.startPayload || ''; // referral code if present

        this.logger.log(`/start received from user: ${username} (${telegramUid}), payload: ${startPayload}`);

        // TODO: Register user in Supabase
        // If startPayload exists, it's a referral code from another user

        const miniAppUrl = this.configService.get<string>('MINI_APP_URL') || 'http://localhost:3001';

        const welcomeMessage = [
          `👋 환영합니다, ${username}!`,
          '',
          '🔥 **DEX MINER BOT**에 오신 것을 환영합니다.',
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
      await this.bot.launch();
      this.logger.log('✅ Telegram bot launched successfully');

      // Graceful shutdown
      process.once('SIGINT', () => this.bot?.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot?.stop('SIGTERM'));
    } catch (error) {
      this.logger.error(`Failed to launch Telegram bot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
