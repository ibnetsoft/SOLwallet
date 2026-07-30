import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
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
   * POST /api/orders — 주문 생성 (unsigned tx 반환)
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
   * POST /api/orders/setup/submit — 첫 거래 전 ATA 생성 트랜잭션 제출
   * ⚠️ :id/submit 보다 먼저 정의해야 함 (안 그러면 'setup'이 :id로 매칭됨)
   * createOrder가 setupTx를 반환한 경우, 주문 tx 전에 먼저 이 엔드포인트로 제출
   */
  @Post('setup/submit')
  async submitSetupTx(
    @CurrentUser() userId: string,
    @Body() dto: SubmitOrderDto,
  ) {
    const result = await this.ordersService.submitSetupTx(dto.signedTx, userId);
    return { success: true, data: result };
  }

  /**
   * POST /api/orders/:id/submit — 서명된 주문 트랜잭션 제출
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
   * POST /api/orders/:id/cancel — 주문 취소 (1단계: unsigned cancel tx 반환)
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
   * POST /api/orders/:id/cancel/submit — 서명된 cancel tx 제출 (2단계)
   */
  @Post(':id/cancel/submit')
  async submitCancelOrder(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: SubmitOrderDto,
  ) {
    const result = await this.ordersService.submitCancelOrder(orderId, dto.signedTx, userId);
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
   * GET /api/orders/history — 과거 주문 내역 (cursor 페이지네이션)
   * ?before=ISO시각&limit=개수 — before 시각보다 이전 주문 반환
   */
  @Get('history')
  async getOrderHistory(
    @CurrentUser() userId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.ordersService.getOrderHistory(
      userId,
      before,
      limit ? Math.min(Number(limit), 100) : undefined,
    );
    return { success: true, data: result };
  }

  /**
   * GET /api/orders/orderbook/:tokenMint — 오더북 조회 (Manifest SDK 프록시)
   */
  @Get('orderbook/:tokenMint')
  async getOrderbook(
    @Param('tokenMint') tokenMint: string,
    @Query('quoteMint') quoteMint?: string,
  ) {
    const orderbook = await this.ordersService.getOrderbook(tokenMint, quoteMint);
    return { success: true, data: orderbook };
  }
}
