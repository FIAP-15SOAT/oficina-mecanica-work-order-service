import { IsIn, IsUUID } from 'class-validator';

import { PaymentFailureReason } from '@application/ports/input/payment/dto/apply-payment-result.dto';

export class PaymentFailedPayloadDto {
  @IsUUID('4')
  paymentId!: string;

  @IsIn(['EXPIRED', 'REJECTED', 'CANCELLED'] satisfies PaymentFailureReason[])
  reason!: PaymentFailureReason;
}
