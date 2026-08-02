import { Module } from '@nestjs/common';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { PriceModule } from '../price/price.module';
import { TransfersModule } from '../transfers/transfers.module';

@Module({
  imports: [PriceModule, TransfersModule],
  controllers: [BalanceController],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
