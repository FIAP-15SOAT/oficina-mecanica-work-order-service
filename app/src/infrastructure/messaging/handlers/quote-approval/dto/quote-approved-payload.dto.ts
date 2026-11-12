import { Type } from 'class-transformer';
import { IsArray, IsInt, IsUUID, Matches, Min, ValidateNested } from 'class-validator';

import { DECIMAL_MONEY_REGEX } from '@domain/constants/regex/decimal-money.regex';

export class ApprovedServicePayloadDto {
  @IsUUID('4')
  serviceId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @Matches(DECIMAL_MONEY_REGEX)
  unitPrice!: string;
}

export class ApprovedPartSupplyPayloadDto {
  @IsUUID('4')
  partSupplyId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @Matches(DECIMAL_MONEY_REGEX)
  unitPrice!: string;
}

export class QuoteApprovedPayloadDto {
  @IsUUID('4')
  quoteId!: string;

  @IsUUID('4')
  decidedBy!: string;

  @Matches(DECIMAL_MONEY_REGEX)
  total!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovedServicePayloadDto)
  services!: ApprovedServicePayloadDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovedPartSupplyPayloadDto)
  partsSupplies!: ApprovedPartSupplyPayloadDto[];
}
