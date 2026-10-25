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

import { VehicleController as VehicleCleanController } from '@interface-adapters/vehicle/vehicle.controller';

import { CreateVehicleRequestDto } from './dto/requests/create-vehicle-request.dto';
import { UpdateVehicleRequestDto } from './dto/requests/update-vehicle-request.dto';
import { FindAllVehiclesQueryDto } from './dto/requests/filter-vehicles.dto';
import { VehicleDataResponseDto } from './dto/responses/vehicle-response.dto';
import { VehiclePaginatedResponseDto } from './dto/responses/vehicle-paginated-response.dto';

@ApiTags('Gestão de Veículos')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Controller('vehicles')
export class VehicleController {
  constructor(private readonly controller: VehicleCleanController) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Cadastrar Veículo' })
  @ApiCreatedResponse({
    type: VehicleDataResponseDto,
    description: 'Veículo cadastrado com sucesso',
  })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiBadRequestResponse({ description: 'Dados inválidos' })
  @ApiUnprocessableEntityResponse({
    description: 'Placa em formato inválido ou ano fora do intervalo permitido',
  })
  @ApiNotFoundResponse({ description: 'Cliente não encontrado' })
  @ApiConflictResponse({ description: 'Placa já cadastrada' })
  create(@Body() request: CreateVehicleRequestDto): Promise<VehicleDataResponseDto> {
    return this.controller.create(request);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Listar Veículos' })
  @ApiOkResponse({ type: VehiclePaginatedResponseDto, description: 'Lista paginada de Veículos' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  findAll(@Query() query: FindAllVehiclesQueryDto): Promise<VehiclePaginatedResponseDto> {
    return this.controller.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Buscar Veículo por ID' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do Veículo' })
  @ApiOkResponse({ type: VehicleDataResponseDto, description: 'Veículo encontrado' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiBadRequestResponse({ description: 'ID inválido (UUID esperado)' })
  @ApiNotFoundResponse({ description: 'Veículo não encontrado' })
  findById(@Param('id', ParseUUIDPipe) id: string): Promise<VehicleDataResponseDto> {
    return this.controller.findById(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Atualizar Veículo' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do Veículo' })
  @ApiOkResponse({ type: VehicleDataResponseDto, description: 'Veículo atualizado com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiBadRequestResponse({ description: 'Dados inválidos ou ID inválido' })
  @ApiUnprocessableEntityResponse({
    description: 'Placa em formato inválido ou ano fora do intervalo permitido',
  })
  @ApiNotFoundResponse({ description: 'Veículo ou cliente não encontrado' })
  @ApiConflictResponse({ description: 'Placa já cadastrada para outro veículo' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: UpdateVehicleRequestDto,
  ): Promise<VehicleDataResponseDto> {
    return this.controller.update(id, request);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Excluir Veículo' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do Veículo' })
  @ApiNoContentResponse({ description: 'Veículo excluído com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiBadRequestResponse({ description: 'ID inválido (UUID esperado)' })
  @ApiNotFoundResponse({ description: 'Veículo não encontrado' })
  @ApiConflictResponse({ description: 'Veículo possui ordens de serviço e não pode ser excluído' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.controller.remove(id);
  }
}
