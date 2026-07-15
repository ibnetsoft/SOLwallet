import { IsString, IsNumber, Min, Matches, IsUUID } from 'class-validator';

export class WithdrawDto {
  @IsUUID()
  walletId!: string;

  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
    message: '올바른 Solana 주소 형식이 아닙니다.',
  })
  toAddress!: string;

  @IsString()
  mint!: string;

  @IsNumber()
  @Min(0.000001, { message: '수량은 0보다 커야 합니다.' })
  amount!: number;
}
