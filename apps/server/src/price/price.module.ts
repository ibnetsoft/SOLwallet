import { Module } from '@nestjs/common';
import { PriceController } from './price.controller';
import { PriceService } from './price.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule], // OrdersService.getOrderbook() 재사용
  controllers: [PriceController],
  providers: [PriceService],
  exports: [PriceService],
})
export class PriceModule {}
