import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import {
  MyQuoteSummaryResponse,
  MyQuoteResponse,
  MyQuoteDataResponse,
  MyQuoteListResponse,
  MyQuoteItemResponse,
} from '@interface-adapters/me/responses/me.response';

export class MyQuoteItemResponseDto implements MyQuoteItemResponse {
  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID do serviço ou peça/insumo',
  })
  id!: string;

  @ApiProperty({ example: 'Troca de óleo', description: 'Nome do serviço ou peça/insumo' })
  name!: string;

  @ApiProperty({ example: 2, description: 'Quantidade' })
  quantity!: number;

  @ApiProperty({ example: 50, description: 'Preço unitário' })
  unitPrice!: number;

  @ApiProperty({ example: 100, description: 'Preço total (quantidade × preço unitário)' })
  totalPrice!: number;
}

/**
 * Summary — used in listings, where the items are not loaded
 * (`findByWorkOrderId` leaves out `services`/`partsSupplies` on purpose).
 */
export class MyQuoteSummaryResponseDto implements MyQuoteSummaryResponse {
  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID do orçamento',
  })
  id!: string;

  @ApiProperty({
    enum: QuoteStatus,
    example: QuoteStatus.SENT,
    description: 'Status do orçamento',
  })
  status!: QuoteStatus;

  @ApiProperty({ example: 150, description: 'Soma dos valores de serviços' })
  servicesAmount!: number;

  @ApiProperty({ example: 80, description: 'Soma dos valores de peças/insumos' })
  partsAmount!: number;

  @ApiProperty({ example: 230, description: 'Valor total do orçamento' })
  totalAmount!: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Cliente pediu revisão completa',
    description: 'Observações do orçamento',
  })
  notes!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-04-20T12:00:00.000Z',
    format: 'date-time',
    description: 'Data de envio do orçamento para aprovação',
  })
  sentAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-04-20T12:00:00.000Z',
    format: 'date-time',
    description: 'Data de aprovação do orçamento',
  })
  approvedAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-04-20T12:00:00.000Z',
    format: 'date-time',
    description: 'Data de rejeição do orçamento',
  })
  rejectedAt!: Date | null;
}

/** Detail — returned when the quote was loaded with `findByIdWithDetails`. */
export class MyQuoteResponseDto extends MyQuoteSummaryResponseDto implements MyQuoteResponse {
  @ApiProperty({ type: [MyQuoteItemResponseDto], description: 'Serviços do orçamento' })
  services!: MyQuoteItemResponseDto[];

  @ApiProperty({ type: [MyQuoteItemResponseDto], description: 'Peças/insumos do orçamento' })
  partsSupplies!: MyQuoteItemResponseDto[];
}

export class MyQuoteDataResponseDto implements MyQuoteDataResponse {
  @ApiProperty({ type: MyQuoteResponseDto, description: 'Dados do orçamento' })
  data!: MyQuoteResponseDto;
}

export class MyQuoteListResponseDto implements MyQuoteListResponse {
  @ApiProperty({
    type: [MyQuoteSummaryResponseDto],
    description:
      'Orçamentos da ordem de serviço (sem itens — use GET /me/quotes/:quoteId para o detalhe)',
  })
  data!: MyQuoteSummaryResponseDto[];
}
