import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { PaginatedResponseDto } from '@infrastructure/http/common/dto/paginated-response.dto';
import {
  MyWorkOrderResponse,
  MyWorkOrderDataResponse,
  MyWorkOrderPaginatedResponse,
  MyVehicleSummary,
  MyCustomerSummary,
} from '@interface-adapters/me/responses/me.response';

export class MyCustomerSummaryDto implements MyCustomerSummary {
  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID do cliente',
  })
  id!: string;

  @ApiProperty({ example: 'Oficina Parceira LTDA', description: 'Nome do cliente' })
  name!: string;

  @ApiProperty({
    enum: CustomerType,
    example: CustomerType.COMPANY,
    description: 'Tipo do cliente: INDIVIDUAL (pessoa física) ou COMPANY (empresa)',
  })
  type!: CustomerType;
}

export class MyVehicleSummaryDto implements MyVehicleSummary {
  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID do veículo',
  })
  id!: string;

  @ApiProperty({ example: 'ABC-1234', description: 'Placa do veículo' })
  plate!: string;

  @ApiProperty({ example: 'Toyota', description: 'Marca do veículo' })
  brand!: string;

  @ApiProperty({ example: 'Corolla', description: 'Modelo do veículo' })
  model!: string;
}

export class MyWorkOrderResponseDto implements MyWorkOrderResponse {
  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID da ordem de serviço',
  })
  id!: string;

  @ApiProperty({ example: '2026-000123', description: 'Número da ordem de serviço' })
  number!: string;

  @ApiProperty({
    enum: WorkOrderStatus,
    example: WorkOrderStatus.IN_DIAGNOSIS,
    description: 'Status da ordem de serviço',
  })
  status!: WorkOrderStatus;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Barulho no motor',
    description: 'Descrição do problema relatado',
  })
  problemDescription!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 45000,
    description: 'Quilometragem do veículo no momento do atendimento',
  })
  mileageAtService!: number | null;

  @ApiProperty({
    type: MyCustomerSummaryDto,
    description: 'Cliente dono desta ordem de serviço',
  })
  customer!: MyCustomerSummaryDto;

  @ApiPropertyOptional({
    type: MyVehicleSummaryDto,
    nullable: true,
    description: 'Veículo atendido nesta ordem de serviço',
  })
  vehicle!: MyVehicleSummaryDto | null;

  @ApiProperty({
    example: '2026-04-20T12:00:00.000Z',
    format: 'date-time',
    description: 'Data de criação da ordem de serviço',
  })
  createdAt!: Date;

  @ApiProperty({
    example: '2026-04-20T12:00:00.000Z',
    format: 'date-time',
    description: 'Data da última atualização da ordem de serviço',
  })
  updatedAt!: Date;
}

export class MyWorkOrderDataResponseDto implements MyWorkOrderDataResponse {
  @ApiProperty({ type: MyWorkOrderResponseDto, description: 'Dados da ordem de serviço' })
  data!: MyWorkOrderResponseDto;
}

export class MyWorkOrderPaginatedResponseDto
  extends PaginatedResponseDto<MyWorkOrderResponseDto>
  implements MyWorkOrderPaginatedResponse
{
  @ApiProperty({
    type: [MyWorkOrderResponseDto],
    description: 'Ordens de serviço dos clientes vinculados ao usuário',
  })
  data!: MyWorkOrderResponseDto[];
}
