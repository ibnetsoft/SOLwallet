import { IsString, IsUUID, IsInt, Min, Max, IsOptional } from 'class-validator';

export class SwapQuoteDto {
  @IsUUID()
  walletId!: string;

  @IsString()
  inputMint!: string;

  @IsString()
  outputMint!: string;

  /** atomic units (토큰 decimals 기준 정수 문자열) */
  @IsString()
  amount!: string;

  /** 슬리피지 허용치 (bps). 기본 50 = 0.5% */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  slippageBps?: number;
}

export class SwapExecuteDto {
  @IsString()
  signedTx!: string;
}
