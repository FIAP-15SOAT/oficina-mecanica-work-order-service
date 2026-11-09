import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

export class MissingStockItemPayloadDto {
  @IsUUID('4')
  partSupplyId!: string;

  @IsInt()
  @Min(1)
  requested!: number;

  @IsInt()
  @Min(0)
  available!: number;
}

export class StockReservationFailedPayloadDto {
  @IsUUID('4')
  quoteId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MissingStockItemPayloadDto)
  missing!: MissingStockItemPayloadDto[];
}
