import { IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class MessageEnvelopeDto {
  @IsUUID('4')
  messageId!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsISO8601({ strict: true })
  occurredAt!: string;

  @IsOptional()
  @IsUUID()
  workOrderId!: string | null;

  @IsObject()
  payload!: object;
}
