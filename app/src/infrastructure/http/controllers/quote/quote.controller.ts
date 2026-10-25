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
  Patch,
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

import { RolesGuard } from '@infrastructure/http/guards/roles.guard';
import { Roles } from '@infrastructure/http/decorators/roles.decorator';
import { CurrentPrincipal } from '@infrastructure/http/decorators/current-principal.decorator';
import { AuthenticatedPrincipal } from '@application/ports/output/authenticated-principal';
import { UserRole } from '@domain/enums/user-role.enum';

import { QuoteController as QuoteCleanController } from '@interface-adapters/quote/quote.controller';

import { CreateQuoteRequestDto } from './dto/requests/create-quote-request.dto';
import { AddQuoteServiceRequestDto } from './dto/requests/add-quote-service-request.dto';
import { AddQuotePartSupplyRequestDto } from './dto/requests/add-quote-part-supply-request.dto';
import { UpdateQuoteServiceItemRequestDto } from './dto/requests/update-quote-service-item-request.dto';
import { UpdateQuotePartSupplyItemRequestDto } from './dto/requests/update-quote-part-supply-item-request.dto';
import { UpdateQuoteStatusRequestDto } from './dto/requests/update-quote-status-request.dto';
import { FindAllQuotesQueryDto } from './dto/requests/find-all-quotes-query.dto';
import {
  QuoteDataResponseDto,
  QuoteWithItemsDataResponseDto,
  QuotePaginatedResponseDto,
} from './dto/responses/quote-response.dto';

@ApiTags('Gestão de Orçamentos')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@Controller('quotes')
@UseGuards(RolesGuard)
@ApiBearerAuth('access-token')
export class QuoteController {
  constructor(private readonly controller: QuoteCleanController) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Listar orçamentos paginado' })
  @ApiOkResponse({ type: QuotePaginatedResponseDto })
  findAll(@Query() query: FindAllQuotesQueryDto): Promise<QuotePaginatedResponseDto> {
    return this.controller.findAll(query);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Criar orçamento para Ordem de Serviço' })
  @ApiCreatedResponse({ type: QuoteDataResponseDto, description: 'Orçamento criado com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Ordem de Serviço não encontrada' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação ou regra de negócio' })
  create(@Body() request: CreateQuoteRequestDto): Promise<QuoteDataResponseDto> {
    return this.controller.create(request);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Buscar orçamento por ID com itens' })
  @ApiOkResponse({ type: QuoteWithItemsDataResponseDto, description: 'Orçamento encontrado' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Orçamento não encontrado' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do orçamento' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<QuoteWithItemsDataResponseDto> {
    return this.controller.findOne(id);
  }

  @Post(':id/services')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Adicionar serviço ao orçamento' })
  @ApiOkResponse({ type: QuoteDataResponseDto, description: 'Serviço adicionado com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Orçamento ou Serviço não encontrado' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação ou regra de negócio' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do orçamento' })
  addService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: AddQuoteServiceRequestDto,
  ): Promise<QuoteDataResponseDto> {
    return this.controller.addService(id, request);
  }

  @Patch(':id/services/:serviceId')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Atualizar quantidade de um serviço no orçamento' })
  @ApiOkResponse({ type: QuoteDataResponseDto, description: 'Quantidade atualizada com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Item não encontrado no orçamento' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação ou regra de negócio' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do orçamento' })
  @ApiParam({ name: 'serviceId', format: 'uuid', description: 'ID do serviço' })
  updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() request: UpdateQuoteServiceItemRequestDto,
  ): Promise<QuoteDataResponseDto> {
    return this.controller.updateService(id, serviceId, request);
  }

  @Delete(':id/services/:serviceId')
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover serviço do orçamento' })
  @ApiNoContentResponse({ description: 'Serviço removido com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Item não encontrado no orçamento' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação ou regra de negócio' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do orçamento' })
  @ApiParam({ name: 'serviceId', format: 'uuid', description: 'ID do serviço' })
  removeService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ): Promise<void> {
    return this.controller.removeService(id, serviceId);
  }

  @Post(':id/parts-supplies')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Adicionar peça/insumo ao orçamento' })
  @ApiOkResponse({ type: QuoteDataResponseDto, description: 'Peça/insumo adicionado com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Orçamento ou Peça não encontrada' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação ou regra de negócio' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do orçamento' })
  addPartSupply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: AddQuotePartSupplyRequestDto,
  ): Promise<QuoteDataResponseDto> {
    return this.controller.addPartSupply(id, request);
  }

  @Patch(':id/parts-supplies/:partSupplyId')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Atualizar quantidade de uma peça/insumo no orçamento' })
  @ApiOkResponse({ type: QuoteDataResponseDto, description: 'Quantidade atualizada com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Item não encontrado no orçamento' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação ou regra de negócio' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do orçamento' })
  @ApiParam({ name: 'partSupplyId', format: 'uuid', description: 'ID da peça/insumo' })
  updatePartSupply(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('partSupplyId', ParseUUIDPipe) partSupplyId: string,
    @Body() request: UpdateQuotePartSupplyItemRequestDto,
  ): Promise<QuoteDataResponseDto> {
    return this.controller.updatePartSupply(id, partSupplyId, request);
  }

  @Delete(':id/parts-supplies/:partSupplyId')
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover peça/insumo do orçamento' })
  @ApiNoContentResponse({ description: 'Peça/insumo removida com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Item não encontrado no orçamento' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação ou regra de negócio' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do orçamento' })
  @ApiParam({ name: 'partSupplyId', format: 'uuid', description: 'ID da peça/insumo' })
  removePartSupply(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('partSupplyId', ParseUUIDPipe) partSupplyId: string,
  ): Promise<void> {
    return this.controller.removePartSupply(id, partSupplyId);
  }

  @Post(':id/submissions')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Enviar orçamento para aprovação do cliente' })
  @ApiOkResponse({ type: QuoteDataResponseDto, description: 'Orçamento enviado com sucesso' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Orçamento ou Ordem de Serviço não encontrada' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação ou regra de negócio' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do orçamento' })
  submit(@Param('id', ParseUUIDPipe) id: string): Promise<QuoteDataResponseDto> {
    return this.controller.submit(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Aprovar ou rejeitar orçamento' })
  @ApiOkResponse({ type: QuoteDataResponseDto, description: 'Status do orçamento atualizado' })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Orçamento não encontrado' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação ou regra de negócio' })
  @ApiBadRequestResponse({ description: 'Justificativa ausente na rejeição' })
  @ApiConflictResponse({ description: 'Modificação concorrente detectada. Tente novamente.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do orçamento' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: UpdateQuoteStatusRequestDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<QuoteDataResponseDto> {
    return this.controller.updateStatus(id, principal.sub, request);
  }
}
