import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { RolesGuard } from '@infrastructure/http/guards/roles.guard';
import { Roles } from '@infrastructure/http/decorators/roles.decorator';
import { CurrentPrincipal } from '@infrastructure/http/decorators/current-principal.decorator';
import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { UserRole } from '@domain/enums/user-role.enum';

import { WorkOrderController as WorkOrderCleanController } from '@interface-adapters/work-order/work-order.controller';

import { CreateWorkOrderRequestDto } from './dto/requests/create-work-order-request.dto';
import { UpdateWorkOrderRequestDto } from './dto/requests/update-work-order-request.dto';
import { UpdateWorkOrderStatusRequestDto } from './dto/requests/update-work-order-status-request.dto';
import { FindAllWorkOrdersPaginatedQueryDto } from './dto/requests/filter-work-orders.dto';
import { UpdateWorkOrderServiceStatusRequestDto } from './dto/requests/update-work-order-service-status-request.dto';
import {
  WorkOrderDataResponseDto,
  WorkOrderPaginatedResponseDto,
  WorkOrderServiceItemDataResponseDto,
} from './dto/responses/work-order-response.dto';
import { StatusHistoryListResponseDto } from './dto/responses/status-history-response.dto';
import { QuoteListResponseDto } from '@infrastructure/http/controllers/quote/dto/responses/quote-response.dto';

@ApiTags('Gestão de Ordens de Serviço')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@Controller('work-orders')
@UseGuards(RolesGuard)
@ApiBearerAuth('access-token')
export class WorkOrderController {
  constructor(private readonly controller: WorkOrderCleanController) {}

  @Get(':id/quotes')
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Listar orçamentos de uma Ordem de Serviço' })
  @ApiOkResponse({ type: QuoteListResponseDto, description: 'Lista de orçamentos' })
  @ApiNotFoundResponse({ description: 'Ordem de Serviço não encontrada' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findQuotes(@Param('id', ParseUUIDPipe) id: string): Promise<QuoteListResponseDto> {
    return this.controller.findQuotes(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Criar nova Ordem de Serviço' })
  @ApiCreatedResponse({
    type: WorkOrderDataResponseDto,
    description: 'Ordem de Serviço criada com sucesso',
  })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Serviço ou peça/insumo não encontrado' })
  @ApiConflictResponse({
    description: 'Regra de negócio violada',
  })
  create(
    @Body() request: CreateWorkOrderRequestDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<WorkOrderDataResponseDto> {
    return this.controller.create(request, principal.sub);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Listar Ordens de Serviço paginado' })
  @ApiOkResponse({ type: WorkOrderPaginatedResponseDto })
  findAll(
    @Query() query: FindAllWorkOrdersPaginatedQueryDto,
  ): Promise<WorkOrderPaginatedResponseDto> {
    return this.controller.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Buscar Ordem de Serviço por ID' })
  @ApiOkResponse({ type: WorkOrderDataResponseDto })
  @ApiNotFoundResponse()
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<WorkOrderDataResponseDto> {
    return this.controller.findOne(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Atualizar Ordem de Serviço' })
  @ApiOkResponse({ type: WorkOrderDataResponseDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse()
  @ApiParam({ name: 'id', format: 'uuid' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: UpdateWorkOrderRequestDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<WorkOrderDataResponseDto> {
    return this.controller.update(id, request, principal.sub);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Atualizar status da Ordem de Serviço' })
  @ApiOkResponse({ type: WorkOrderDataResponseDto, description: 'Status atualizado com sucesso' })
  @ApiNotFoundResponse({ description: 'Ordem de Serviço não encontrada' })
  @ApiUnprocessableEntityResponse({ description: 'Transição de status inválida' })
  @ApiConflictResponse({ description: 'Modificação concorrente detectada. Tente novamente.' })
  @ApiBadRequestResponse({ description: 'Dados inválidos ou ID inválido' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiParam({ name: 'id', format: 'uuid' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: UpdateWorkOrderStatusRequestDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<WorkOrderDataResponseDto> {
    return this.controller.updateStatus(id, request, principal.sub);
  }

  @Patch(':workOrderId/services/:serviceId')
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT, UserRole.MECHANIC)
  @ApiOperation({ summary: 'Atualizar status de serviço da Ordem de Serviço' })
  @ApiOkResponse({
    type: WorkOrderServiceItemDataResponseDto,
    description: 'Status do serviço atualizado',
  })
  @ApiNotFoundResponse({ description: 'Ordem de Serviço ou serviço não encontrado' })
  @ApiConflictResponse({ description: 'Modificação concorrente detectada. Tente novamente.' })
  @ApiBadRequestResponse({ description: 'Dados inválidos ou ID inválido' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiParam({ name: 'workOrderId', format: 'uuid' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  updateServiceStatus(
    @Param('workOrderId', ParseUUIDPipe) workOrderId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() request: UpdateWorkOrderServiceStatusRequestDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<WorkOrderServiceItemDataResponseDto> {
    return this.controller.updateServiceStatus(workOrderId, serviceId, request, principal.sub);
  }

  @Get(':id/status-history')
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Histórico de status da Ordem de Serviço' })
  @ApiOkResponse({ type: StatusHistoryListResponseDto })
  @ApiNotFoundResponse()
  @ApiParam({ name: 'id', format: 'uuid' })
  getStatusHistory(@Param('id', ParseUUIDPipe) id: string): Promise<StatusHistoryListResponseDto> {
    return this.controller.getStatusHistory(id);
  }
}
