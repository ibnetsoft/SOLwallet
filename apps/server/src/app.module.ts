import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { SupabaseModule } from './supabase/supabase.module';
import { TelegramModule } from './telegram/telegram.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { WalletModule } from './wallet/wallet.module';
import { OrdersModule } from './orders/orders.module';
import { BalanceModule } from './balance/balance.module';
import { TokensModule } from './tokens/tokens.module';
import { AdminModule } from './admin/admin.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    // 글로벌 Rate Limiting — auth 엔드포인트에서 별도 override
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    SupabaseModule,
    TelegramModule,
    AuthModule,
    UserModule,
    WalletModule,
    OrdersModule,
    BalanceModule,
    TokensModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
