import { IsISO8601, IsUrl, IsUUID, Matches } from 'class-validator';

import { DECIMAL_MONEY_REGEX } from '@domain/constants/regex/decimal-money.regex';

export class PaymentRequestedPayloadDto {
  @IsUUID('4')
  paymentId!: string;

  @Matches(DECIMAL_MONEY_REGEX)
  amount!: string;

  // The link goes into the e-mail HTML, so only web URLs pass.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  checkoutUrl!: string;

  @IsISO8601({ strict: true })
  expiresAt!: string;
}
