import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatusService } from './order-status.service';

/**
 * 주문 체결 상태 폴링 스케줄러
 *
 * 30초마다 submitted 주문의 tx_signature를 확인하여 체결/실패/만료 처리.
 */
@Injectable()
export class OrderStatusScheduler {
  private readonly logger = new Logger(OrderStatusScheduler.name);
  private isRunning = false;

  constructor(private readonly orderStatusService: OrderStatusService) {}

  /**
   * 30초마다 submitted 주문 체결 확인
   * 중복 실행 방지 (이전 실행이 진행 중이면 스킵)
   */
  @Cron('*/30 * * * * *')
  async handleOrderStatusCheck() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.orderStatusService.checkPendingOrders();
    } catch (err) {
      this.logger.error(`Order status poll failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.isRunning = false;
    }
  }
}
