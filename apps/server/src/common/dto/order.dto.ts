import { IsString, IsEnum, IsNumber, Min, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  tokenId!: string;

  @IsUUID()
  walletId!: string;

  @IsEnum(['buy', 'sell'])
  side!: 'buy' | 'sell';

  @IsNumber()
  @Min(0.000001, { message: '가격은 0보다 커야 합니다.' })
  price!: number;

  @IsNumber()
  @Min(0.000001, { message: '수량은 0보다 커야 합니다.' })
  quantity!: number;
}

export class SubmitOrderDto {
  @IsString()
  signedTx!: string;
}
