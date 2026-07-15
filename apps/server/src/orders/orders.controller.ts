import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../common/interfaces/authenticated-request';
import { CreateOrderDto, SubmitOrderDto } from '../common/dto/order.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * POST /api/orders — 주문 생성
   */
  @Post()
  async createOrder(
    @CurrentUser() userId: string,
    @Body() dto: CreateOrderDto,
  ) {
    const result = await this.ordersService.createOrder(userId, dto);
    return { success: true, data: result };
  }

  /**
   * POST /api/orders/:id/submit — 서명된 트랜잭션 제출
   */
  @Post(':id/submit')
  async submitOrder(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: SubmitOrderDto,
  ) {
    const result = await this.ordersService.submitOrder(orderId, dto.signedTx, userId);
    return { success: true, data: result };
  }

  /**
   * POST /api/orders/:id/cancel — 주문 취소
   */
  @Post(':id/cancel')
  async cancelOrder(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) orderId: string,
  ) {
    const result = await this.ordersService.cancelOrder(orderId, userId);
    return { success: true, data: result };
  }

  /**
   * GET /api/orders/active — 활성 주문 목록
   */
  @Get('active')
  async getActiveOrders(@CurrentUser() userId: string) {
    const orders = await this.ordersService.getActiveOrders(userId);
    return { success: true, data: orders };
  }

  /**
   * GET /api/orders/history — 과거 주문 내역
   */
  @Get('history')
  async getOrderHistory(@CurrentUser() userId: string) {
    const orders = await this.ordersService.getOrderHistory(userId);
    return { success: true, data: orders };
  }

  /**
   * GET /api/orders/orderbook/:tokenMint — 오더북 조회
   */
  @Get('orderbook/:tokenMint')
  async getOrderbook(@Param('tokenMint') tokenMint: string) {
    const orderbook = await this.ordersService.getOrderbook(tokenMint);
    return { success: true, data: orderbook };
  }
}
