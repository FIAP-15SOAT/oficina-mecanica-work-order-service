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
import { CurrentPrincipal } from '@infrastructure/http/decorators/current-principal.decorator';
import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';

import { CustomerController as CustomerCleanController } from '@interface-adapters/customer/customer.controller';
import { UserRole } from '@domain/enums/user-role.enum';

import { CreateCustomerRequestDto } from './dto/requests/create-customer-request.dto';
import { UpdateCustomerRequestDto } from './dto/requests/update-customer-request.dto';
import { FindAllCustomersQueryDto } from './dto/requests/filter-customers.dto';
import { CustomerDataResponseDto } from './dto/responses/customer-response.dto';
import { CustomerPaginatedResponseDto } from './dto/responses/customer-paginated-response.dto';

@ApiTags('Gestão de Clientes')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Controller('customers')
export class CustomerController {
  constructor(private readonly controller: CustomerCleanController) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Cadastrar Cliente' })
  @ApiCreatedResponse({
    type: CustomerDataResponseDto,
    description: 'Cliente cadastrado com sucesso',
  })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiBadRequestResponse({ description: 'Dados inválidos' })
  @ApiUnprocessableEntityResponse({
    description: 'Erro de validação de domínio (documento inválido)',
  })
  @ApiConflictResponse({ description: 'Documento ou e-mail já cadastrado' })
  create(
    @Body() request: CreateCustomerRequestDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<CustomerDataResponseDto> {
    return this.controller.create(request, principal.sub);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Listar Clientes' })
  @ApiOkResponse({ type: CustomerPaginatedResponseDto, description: 'Lista paginada de Clientes' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  findAll(@Query() query: FindAllCustomersQueryDto): Promise<CustomerPaginatedResponseDto> {
    return this.controller.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Buscar Cliente por ID' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do Cliente' })
  @ApiOkResponse({ type: CustomerDataResponseDto, description: 'Cliente encontrado' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiBadRequestResponse({ description: 'ID inválido (UUID esperado)' })
  @ApiNotFoundResponse({ description: 'Cliente não encontrado' })
  findById(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerDataResponseDto> {
    return this.controller.findById(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Atualizar Cliente' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do Cliente' })
  @ApiOkResponse({ type: CustomerDataResponseDto, description: 'Cliente atualizado com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiBadRequestResponse({ description: 'Dados inválidos ou ID inválido' })
  @ApiUnprocessableEntityResponse({
    description: 'Erro de validação de domínio (documento inválido)',
  })
  @ApiNotFoundResponse({ description: 'Cliente não encontrado' })
  @ApiConflictResponse({ description: 'Documento ou e-mail já cadastrado para outro cliente' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: UpdateCustomerRequestDto,
  ): Promise<CustomerDataResponseDto> {
    return this.controller.update(id, request);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Excluir Cliente' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do Cliente' })
  @ApiNoContentResponse({ description: 'Cliente excluído com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiBadRequestResponse({ description: 'ID inválido (UUID esperado)' })
  @ApiNotFoundResponse({ description: 'Cliente não encontrado' })
  @ApiConflictResponse({ description: 'Cliente possui vínculos e não pode ser excluído' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.controller.remove(id);
  }
}
