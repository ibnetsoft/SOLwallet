import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * POST /api/orders — 주문 생성
   */
  @Post()
  async createOrder(
    @Req() req: Request,
    @Body() body: { tokenId: string; walletId: string; side: string; price: string; quantity: string },
  ) {
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    const result = await this.ordersService.createOrder(userId, body.walletId, {
      tokenId: body.tokenId,
      side: body.side as 'buy' | 'sell',
      price: Number(body.price),
      quantity: Number(body.quantity),
    });

    return { success: true, data: result };
  }

  /**
   * POST /api/orders/:id/submit — 서명된 트랜잭션 제출
   */
  @Post(':id/submit')
  async submitOrder(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() body: { signedTx: string },
  ) {
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    const result = await this.ordersService.submitOrder(orderId, body.signedTx, userId);

    return { success: true, data: result };
  }

  /**
   * POST /api/orders/:id/cancel — 주문 취소
   */
  @Post(':id/cancel')
  async cancelOrder(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) orderId: string,
  ) {
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    const result = await this.ordersService.cancelOrder(orderId, userId);

    return { success: true, data: result };
  }

  /**
   * GET /api/orders/active — 활성 주문 목록
   */
  @Get('active')
  async getActiveOrders(@Req() req: Request) {
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    const orders = await this.ordersService.getActiveOrders(userId);

    return { success: true, data: orders };
  }

  /**
   * GET /api/orders/history — 과거 주문 내역
   */
  @Get('history')
  async getOrderHistory(@Req() req: Request) {
    const userId = (req as unknown as { user: { sub: string } }).user.sub;

    const orders = await this.ordersService.getOrderHistory(userId);

    return { success: true, data: orders };
  }

  /**
   * GET /api/orderbook/:tokenMint — 오더북 조회
   */
  @Get('orderbook/:tokenMint')
  async getOrderbook(@Param('tokenMint') tokenMint: string) {
    const orderbook = await this.ordersService.getOrderbook(tokenMint);

    return { success: true, data: orderbook };
  }
}
