import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderStatusService } from './order-status.service';
import { OrderStatusScheduler } from './order-status.scheduler';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderStatusService, OrderStatusScheduler],
  exports: [OrdersService],
})
export class OrdersModule {}
