import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { UserRole } from '@domain/enums/user-role.enum';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { PaginatedResponseDto } from '@infrastructure/http/common/dto/paginated-response.dto';
import {
  WorkOrderAssignedUserResponse,
  WorkOrderCustomerResponse,
  WorkOrderDataResponse,
  WorkOrderPaginatedResponse,
  WorkOrderPartSupplyItemResponse,
  WorkOrderResponse,
  WorkOrderServiceItemResponse,
  WorkOrderServiceItemDataResponse,
  WorkOrderVehicleResponse,
} from '@interface-adapters/work-order/responses/work-order.response';

export class WorkOrderCustomerResponseDto implements WorkOrderCustomerResponse {
  @ApiProperty({
    description: 'ID único do Cliente',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ description: 'Nome do Cliente', example: 'João da Silva' })
  name!: string;

  @ApiProperty({
    enum: CustomerType,
    description: 'Tipo de pessoa',
    example: CustomerType.INDIVIDUAL,
  })
  type!: CustomerType;

  @ApiProperty({ description: 'CPF ou CNPJ', example: '123.456.789-09' })
  document!: string;

  @ApiProperty({ description: 'E-mail', example: 'joao@email.com' })
  email!: string;

  @ApiProperty({ description: 'Telefone', example: '(11) 99999-9999' })
  phone!: string;
}

export class WorkOrderVehicleResponseDto implements WorkOrderVehicleResponse {
  @ApiProperty({
    description: 'ID único do Veículo',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ description: 'Placa do veículo', example: 'ABC-1234' })
  plate!: string;

  @ApiProperty({ description: 'Marca', example: 'Toyota' })
  brand!: string;

  @ApiProperty({ description: 'Modelo', example: 'Corolla' })
  model!: string;

  @ApiProperty({ description: 'Ano de fabricação', example: 2020 })
  year!: number;

  @ApiPropertyOptional({ description: 'Cor', example: 'Prata', nullable: true })
  color!: string | null;

  @ApiPropertyOptional({ description: 'Quilometragem atual', example: 50000, nullable: true })
  mileage!: number | null;
}

export class WorkOrderAssignedUserResponseDto implements WorkOrderAssignedUserResponse {
  @ApiProperty({
    description: 'ID único do Usuário',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ description: 'Nome do Usuário', example: 'Carlos Mecânico' })
  name!: string;

  @ApiProperty({ description: 'E-mail do Usuário', example: 'carlos@oficina.com' })
  email!: string;

  @ApiProperty({
    enum: UserRole,
    description: 'Perfil de acesso',
    example: UserRole.MECHANIC,
    nullable: true,
  })
  role!: UserRole | null;
}

export class WorkOrderServiceItemResponseDto implements WorkOrderServiceItemResponse {
  @ApiProperty({
    description: 'ID único do Serviço',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    format: 'uuid',
  })
  id!: string;

  @ApiPropertyOptional({
    description: 'Nome do Serviço',
    example: 'Troca de óleo',
    nullable: true,
  })
  name!: string | null;

  @ApiPropertyOptional({
    description: 'Descrição do Serviço',
    example: 'Troca de óleo com filtro',
    nullable: true,
  })
  description!: string | null;

  @ApiProperty({ description: 'Quantidade', example: 1 })
  quantity!: number;

  @ApiProperty({ description: 'Preço unitário cobrado', example: 129.9 })
  unitPrice!: number;

  @ApiProperty({ description: 'Preço total (unitário × quantidade)', example: 129.9 })
  totalPrice!: number;

  @ApiProperty({
    enum: WorkOrderServiceStatus,
    description: 'Status de execução do serviço',
    example: WorkOrderServiceStatus.PENDING,
  })
  status!: WorkOrderServiceStatus;

  @ApiPropertyOptional({
    description: 'Data/hora de início da execução',
    example: '2026-04-21T09:00:00.000Z',
    nullable: true,
  })
  startedAt!: Date | null;

  @ApiPropertyOptional({
    description: 'Data/hora de conclusão',
    example: '2026-04-21T10:00:00.000Z',
    nullable: true,
  })
  finishedAt!: Date | null;

  @ApiProperty({
    description: 'Data de cadastro do item',
    example: '2026-04-20T08:00:00.000Z',
    format: 'date-time',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Data da última atualização',
    example: '2026-04-21T10:00:00.000Z',
    format: 'date-time',
  })
  updatedAt!: Date;
}

export class WorkOrderServiceItemDataResponseDto implements WorkOrderServiceItemDataResponse {
  @ApiProperty({
    type: WorkOrderServiceItemResponseDto,
    description: 'Dados do Serviço na Ordem de Serviço',
  })
  data!: WorkOrderServiceItemResponseDto;
}

export class WorkOrderPartSupplyItemResponseDto implements WorkOrderPartSupplyItemResponse {
  @ApiProperty({
    description: 'ID único da Peça ou Insumo',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    format: 'uuid',
  })
  id!: string;

  @ApiPropertyOptional({
    description: 'Nome da Peça ou Insumo',
    example: 'Filtro de Óleo',
    nullable: true,
  })
  name!: string | null;

  @ApiPropertyOptional({
    description: 'Descrição detalhada',
    example: 'Filtro para motor 1.0',
    nullable: true,
  })
  description!: string | null;

  @ApiPropertyOptional({ description: 'SKU único no Estoque', example: 'FO-001', nullable: true })
  sku!: string | null;

  @ApiPropertyOptional({
    description: 'Número de referência do fabricante',
    example: 'MANN-W712',
    nullable: true,
  })
  partNumber!: string | null;

  @ApiPropertyOptional({
    enum: ['PART', 'SUPPLY'],
    description: 'Categoria: PART (Peça) ou SUPPLY (Insumo)',
    example: 'PART',
    nullable: true,
  })
  category!: string | null;

  @ApiPropertyOptional({
    enum: ['UN', 'KG', 'L', 'ML', 'M', 'CX', 'PC', 'JG'],
    description: 'Unidade de medida',
    example: 'UN',
    nullable: true,
  })
  unit!: string | null;

  @ApiProperty({ description: 'Quantidade utilizada', example: 2 })
  quantity!: number;

  @ApiProperty({ description: 'Preço unitário cobrado', example: 45.0 })
  unitPrice!: number;

  @ApiProperty({ description: 'Preço total (unitário × quantidade)', example: 90.0 })
  totalPrice!: number;
}

export class WorkOrderResponseDto implements WorkOrderResponse {
  @ApiProperty({
    description: 'ID único da Ordem de Serviço',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ description: 'Número sequencial da Ordem de Serviço', example: '000001' })
  number!: string;

  @ApiProperty({
    type: WorkOrderCustomerResponseDto,
    description: 'Dados do Cliente proprietário do veículo',
  })
  customer!: WorkOrderCustomerResponseDto;

  @ApiProperty({
    type: WorkOrderVehicleResponseDto,
    description: 'Dados do Veículo em atendimento',
  })
  vehicle!: WorkOrderVehicleResponseDto;

  @ApiPropertyOptional({
    type: WorkOrderAssignedUserResponseDto,
    description: 'Mecânico responsável pela OS',
    nullable: true,
  })
  assignedUser!: WorkOrderAssignedUserResponseDto | null;

  @ApiProperty({
    enum: WorkOrderStatus,
    description: 'Status atual da Ordem de Serviço',
    example: WorkOrderStatus.RECEIVED,
  })
  status!: WorkOrderStatus;

  @ApiPropertyOptional({
    description: 'Descrição do problema relatado pelo cliente',
    example: 'Barulho ao frear',
    nullable: true,
  })
  problemDescription!: string | null;

  @ApiPropertyOptional({
    description: 'Notas internas dos mecânicos',
    example: 'Pastilhas traseiras desgastadas',
    nullable: true,
  })
  internalNotes!: string | null;

  @ApiPropertyOptional({
    description: 'Quilometragem no momento do atendimento',
    example: 52000,
    nullable: true,
  })
  mileageAtService!: number | null;

  @ApiProperty({ description: 'Valor total da Ordem de Serviço', example: 350.0 })
  totalAmount!: number;

  @ApiPropertyOptional({
    description: 'Data/hora de aprovação pelo cliente',
    example: '2026-04-21T11:00:00.000Z',
    nullable: true,
  })
  approvedAt!: Date | null;

  @ApiPropertyOptional({
    description: 'Data/hora de início do atendimento',
    example: '2026-04-21T09:00:00.000Z',
    nullable: true,
  })
  startedAt!: Date | null;

  @ApiPropertyOptional({
    description: 'Data/hora de conclusão',
    example: '2026-04-21T17:00:00.000Z',
    nullable: true,
  })
  finishedAt!: Date | null;

  @ApiPropertyOptional({
    description: 'Data/hora de entrega do veículo',
    example: '2026-04-22T10:00:00.000Z',
    nullable: true,
  })
  deliveredAt!: Date | null;

  @ApiProperty({
    description: 'Data de abertura da Ordem de Serviço',
    example: '2026-04-20T08:00:00.000Z',
    format: 'date-time',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Data da última atualização',
    example: '2026-04-21T17:00:00.000Z',
    format: 'date-time',
  })
  updatedAt!: Date;

  @ApiPropertyOptional({
    type: [WorkOrderServiceItemResponseDto],
    description: 'Serviços incluídos na OS (presente apenas no detalhe)',
  })
  services?: WorkOrderServiceItemResponseDto[];

  @ApiPropertyOptional({
    type: [WorkOrderPartSupplyItemResponseDto],
    description: 'Peças e insumos utilizados (presente apenas no detalhe)',
  })
  partSupplies?: WorkOrderPartSupplyItemResponseDto[];
}

export class WorkOrderDataResponseDto implements WorkOrderDataResponse {
  @ApiProperty({ type: WorkOrderResponseDto, description: 'Dados da Ordem de Serviço' })
  data!: WorkOrderResponseDto;
}

export class WorkOrderPaginatedResponseDto
  extends PaginatedResponseDto<WorkOrderResponseDto>
  implements WorkOrderPaginatedResponse
{
  @ApiProperty({ type: [WorkOrderResponseDto], description: 'Ordens de Serviço da página atual' })
  data!: WorkOrderResponseDto[];
}
