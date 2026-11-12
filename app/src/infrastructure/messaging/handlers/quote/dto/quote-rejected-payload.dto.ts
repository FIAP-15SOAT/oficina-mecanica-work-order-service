import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from 'class-validator';

export class QuoteRejectedPayloadDto {
  @IsUUID('4')
  quoteId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsInt()
  @Min(0)
  remainingSentCount!: number;

  @IsUUID('4')
  decidedBy!: string;
}
