import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from './supabase/supabase.module';
import { TelegramModule } from './telegram/telegram.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { WalletModule } from './wallet/wallet.module';
import { OrdersModule } from './orders/orders.module';
import { BalanceModule } from './balance/balance.module';
import { TokensModule } from './tokens/tokens.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
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
})
export class AppModule {}
