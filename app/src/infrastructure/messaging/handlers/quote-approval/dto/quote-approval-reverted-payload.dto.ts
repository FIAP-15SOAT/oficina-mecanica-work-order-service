import { IsIn, IsUUID } from 'class-validator';

export class QuoteApprovalRevertedPayloadDto {
  @IsUUID('4')
  quoteId!: string;

  @IsIn(['SENT', 'REJECTED'])
  revertTo!: 'SENT' | 'REJECTED';
}
