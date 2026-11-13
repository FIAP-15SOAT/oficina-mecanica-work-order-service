import { ApiProperty } from '@nestjs/swagger';
import { BillingPaymentStatus } from '@application/ports/output/gateways/billing/billing-payments-gateway.response';
import {
  MyPaymentResponse,
  MyPaymentListResponse,
} from '@interface-adapters/me/responses/me.response';

export class MyPaymentResponseDto implements MyPaymentResponse {
  @ApiProperty({
    format: 'uuid',
    example: '8b2d4f6a-1c3e-4a5b-9d7f-0e2c4a6b8d1f',
    description: 'ID da cobrança',
  })
  id!: string;

  @ApiProperty({ example: 400, description: 'Valor da cobrança' })
  amount!: number;

  @ApiProperty({
    enum: BillingPaymentStatus,
    example: BillingPaymentStatus.PENDING,
    description: 'Status da cobrança',
  })
  status!: BillingPaymentStatus;

  @ApiProperty({
    example: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=2',
    description: 'Link de pagamento da cobrança',
  })
  checkoutUrl!: string;

  @ApiProperty({
    example: '2026-10-29T10:00:00.000-03:00',
    format: 'date-time',
    description: 'Data até a qual o link de pagamento vale',
  })
  expiresAt!: string;

  @ApiProperty({
    example: '2026-10-28T10:00:00.000-03:00',
    format: 'date-time',
    description: 'Data de criação da cobrança',
  })
  createdAt!: string;

  @ApiProperty({
    example: '2026-10-28T10:00:00.000-03:00',
    format: 'date-time',
    description: 'Data da última atualização da cobrança',
  })
  updatedAt!: string;
}

export class MyPaymentListResponseDto implements MyPaymentListResponse {
  @ApiProperty({ type: [MyPaymentResponseDto], description: 'Cobranças da ordem de serviço' })
  data!: MyPaymentResponseDto[];
}
