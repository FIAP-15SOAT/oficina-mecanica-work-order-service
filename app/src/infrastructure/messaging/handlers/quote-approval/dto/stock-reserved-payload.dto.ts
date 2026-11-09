import { IsUUID } from 'class-validator';

export class StockReservedPayloadDto {
  @IsUUID('4')
  quoteId!: string;
}
