import { IsUUID } from 'class-validator';

// Only the payment id is read: a drift in the amount or the paid date must not dead-letter an
// approval and leave the work order held.
export class PaymentApprovedPayloadDto {
  @IsUUID('4')
  paymentId!: string;
}
