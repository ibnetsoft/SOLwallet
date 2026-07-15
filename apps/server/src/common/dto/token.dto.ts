import { IsString, IsNumber, Min, Max, Matches, Length } from 'class-validator';

export class CreateTokenDto {
  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
    message: '올바른 Solana mint address 형식이 아닙니다.',
  })
  mintAddress!: string;

  @IsString()
  @Length(2, 12, { message: '심볼은 2~12자여야 합니다.' })
  symbol!: string;

  @IsNumber()
  @Min(0, { message: 'decimals는 0 이상이어야 합니다.' })
  @Max(9, { message: 'decimals는 9 이하여야 합니다.' })
  decimals!: number;
}
