import { IsISO8601, IsUUID, Matches } from 'class-validator';

import { DECIMAL_MONEY_REGEX } from '@domain/constants/regex/decimal-money.regex';

export class PaymentApprovedPayloadDto {
  @IsUUID('4')
  paymentId!: string;

  @Matches(DECIMAL_MONEY_REGEX)
  amount!: string;

  @IsISO8601({ strict: true })
  paidAt!: string;
}
