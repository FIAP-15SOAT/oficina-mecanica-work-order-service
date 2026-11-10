import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

import { DECIMAL_MONEY_REGEX } from '@domain/constants/regex/decimal-money.regex';

export class SentQuoteItemPayloadDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @Matches(DECIMAL_MONEY_REGEX)
  unitPrice!: string;
}

export class QuoteSentPayloadDto {
  @IsUUID('4')
  quoteId!: string;

  @IsUUID('4')
  sentBy!: string;

  @Matches(DECIMAL_MONEY_REGEX)
  total!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SentQuoteItemPayloadDto)
  items!: SentQuoteItemPayloadDto[];
}
