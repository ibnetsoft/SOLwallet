import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule implements OnModuleInit {
  constructor(
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (token) {
      // Telegram bot을 비동기로 시작 — 서버 부팅을 블로킹하지 않음
      // bot.launch()는 long polling으로 인해 hang될 수 있음
      this.telegramService.launchBot(token).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('⚠️ Telegram bot failed to start:', err instanceof Error ? err.message : String(err));
      });
    } else {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN is not set. Bot will not run.');
    }
  }
}
