import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { Roles } from '@infrastructure/http/decorators/roles.decorator';
import { RolesGuard } from '@infrastructure/http/guards/roles.guard';
import { UserRole } from '@domain/enums/user-role.enum';

import { ServiceController as ServiceCleanController } from '@interface-adapters/service/service.controller';

import { ServicePaginatedResponseDto } from './dto/responses/service-paginated-response.dto';
import { ServiceDataResponseDto } from './dto/responses/service-response.dto';
import { CreateServiceRequestDto } from './dto/requests/create-service-request.dto';
import { FindAllServicesQueryDto } from './dto/requests/filter-services.dto';
import { UpdateServiceRequestDto } from './dto/requests/update-service-request.dto';
import { ServiceMetricsDataResponseDto } from './dto/responses/service-metrics-response.dto';

@ApiTags('Gestão de Serviços')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@Controller('services')
@UseGuards(RolesGuard)
@ApiBearerAuth('access-token')
export class ServiceController {
  constructor(private readonly controller: ServiceCleanController) {}

  @Get(':id/metrics')
  @Roles(UserRole.ADMIN)
  @ApiTags('Gestão de Serviços - Métricas')
  @ApiOperation({ summary: 'Obter métricas de um serviço específico' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    type: ServiceMetricsDataResponseDto,
    description: 'Métricas do serviço solicitado',
  })
  getMetrics(@Param('id', ParseUUIDPipe) id: string): Promise<ServiceMetricsDataResponseDto> {
    return this.controller.getMetrics(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Criar novo serviço' })
  @ApiCreatedResponse({ type: ServiceDataResponseDto, description: 'Serviço criado com sucesso' })
  @ApiBadRequestResponse({ description: 'Dados inválidos' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiConflictResponse({ description: 'Serviço já cadastrado' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação de domínio' })
  create(@Body() request: CreateServiceRequestDto): Promise<ServiceDataResponseDto> {
    return this.controller.create(request);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT, UserRole.MECHANIC)
  @ApiOperation({ summary: 'Listar serviços paginados (somente Admin)' })
  @ApiOkResponse({ type: ServicePaginatedResponseDto, description: 'Lista paginada de serviços' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  findAll(@Query() query: FindAllServicesQueryDto): Promise<ServicePaginatedResponseDto> {
    return this.controller.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Buscar serviço por ID (somente Admin)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do serviço' })
  @ApiOkResponse({ type: ServiceDataResponseDto, description: 'Serviço encontrado' })
  @ApiBadRequestResponse({ description: 'ID inválido (UUID esperado)' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Serviço não encontrado' })
  findById(@Param('id', ParseUUIDPipe) id: string): Promise<ServiceDataResponseDto> {
    return this.controller.findById(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Atualizar dados do serviço (somente Admin)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do serviço' })
  @ApiOkResponse({ type: ServiceDataResponseDto, description: 'Serviço atualizado' })
  @ApiBadRequestResponse({ description: 'Dados inválidos ou ID com formato incorreto' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Serviço não encontrado' })
  @ApiConflictResponse({ description: 'Outro serviço com o mesmo nome já existe' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação de domínio' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: UpdateServiceRequestDto,
  ): Promise<ServiceDataResponseDto> {
    return this.controller.update(id, request);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover serviço (somente Admin)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do serviço' })
  @ApiNoContentResponse({ description: 'Serviço removido' })
  @ApiBadRequestResponse({ description: 'ID inválido (UUID esperado)' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Serviço não encontrado' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.controller.remove(id);
  }
}
