import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SubAdminController } from './subadmin.controller';
import { SubAdminService } from './subadmin.service';
import { BalanceModule } from '../balance/balance.module';
import { TransfersModule } from '../transfers/transfers.module';
import { OrdersModule } from '../orders/orders.module';
import { PriceModule } from '../price/price.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [AuthModule, BalanceModule, TransfersModule, OrdersModule, PriceModule, WalletModule],
  controllers: [AdminController, SubAdminController],
  providers: [AdminService, SubAdminService],
  exports: [AdminService, SubAdminService],
})
export class AdminModule {}
