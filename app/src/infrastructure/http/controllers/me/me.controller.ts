import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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

import { CustomerArea } from '@infrastructure/http/decorators/customer-area.decorator';
import { CurrentPrincipal } from '@infrastructure/http/decorators/current-principal.decorator';
import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';

import { MeController as MeCleanController } from '@interface-adapters/me/me.controller';
import { ChangeOwnPasswordRequestDto } from './dto/requests/change-own-password-request.dto';
import { FindMyWorkOrdersQueryDto } from './dto/requests/find-my-work-orders-query.dto';
import { DecideMyQuoteRequestDto } from './dto/requests/decide-my-quote-request.dto';
import { MeDataResponseDto } from './dto/responses/me-response.dto';
import {
  MyWorkOrderDataResponseDto,
  MyWorkOrderPaginatedResponseDto,
} from './dto/responses/my-work-order-response.dto';
import {
  MyQuoteDataResponseDto,
  MyQuoteListResponseDto,
} from './dto/responses/my-quote-response.dto';

@ApiTags('Minha Conta')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@ApiBearerAuth('access-token')
@Controller('me')
export class MeController {
  constructor(private readonly controller: MeCleanController) {}

  @Get()
  @CustomerArea('any')
  @ApiOperation({ summary: 'Identidade do sujeito autenticado (interno ou externo)' })
  @ApiOkResponse({ type: MeDataResponseDto })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  getMe(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<MeDataResponseDto> {
    return this.controller.getMe(principal);
  }

  @Patch('password')
  @CustomerArea('any')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Trocar a própria senha (token interno ou externo)' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Não autenticado ou senha atual incorreta' })
  @ApiUnprocessableEntityResponse({ description: 'Nova senha não atende aos requisitos de força' })
  @ApiConflictResponse({ description: 'Nova senha é igual à senha atual' })
  changePassword(
    @Body() request: ChangeOwnPasswordRequestDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<void> {
    return this.controller.changePassword(principal.sub, request);
  }

  @Get('work-orders')
  @CustomerArea()
  @ApiOperation({ summary: 'Listar ordens de serviço dos clientes vinculados' })
  @ApiOkResponse({ type: MyWorkOrderPaginatedResponseDto })
  listWorkOrders(
    @Query() query: FindMyWorkOrdersQueryDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MyWorkOrderPaginatedResponseDto> {
    return this.controller.listWorkOrders(
      principal.sub,
      { page: query.page ?? 1, limit: query.limit ?? 10 },
      query.customerId,
    );
  }

  @Get('work-orders/:workOrderId')
  @CustomerArea()
  @ApiOperation({ summary: 'Detalhe externo de uma ordem de serviço vinculada' })
  @ApiParam({ name: 'workOrderId', format: 'uuid' })
  @ApiOkResponse({ type: MyWorkOrderDataResponseDto })
  @ApiNotFoundResponse({ description: 'Ordem inexistente ou não vinculada' })
  getWorkOrder(
    @Param('workOrderId', ParseUUIDPipe) workOrderId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MyWorkOrderDataResponseDto> {
    return this.controller.getWorkOrder(principal.sub, workOrderId);
  }

  @Get('work-orders/:workOrderId/quotes')
  @CustomerArea()
  @ApiOperation({ summary: 'Orçamentos de uma ordem de serviço vinculada' })
  @ApiParam({ name: 'workOrderId', format: 'uuid' })
  @ApiOkResponse({ type: MyQuoteListResponseDto })
  @ApiNotFoundResponse({ description: 'Ordem inexistente ou não vinculada' })
  listWorkOrderQuotes(
    @Param('workOrderId', ParseUUIDPipe) workOrderId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MyQuoteListResponseDto> {
    return this.controller.listWorkOrderQuotes(principal.sub, workOrderId);
  }

  @Get('quotes/:quoteId')
  @CustomerArea()
  @ApiOperation({ summary: 'Orçamento e itens de uma ordem vinculada' })
  @ApiParam({ name: 'quoteId', format: 'uuid' })
  @ApiOkResponse({ type: MyQuoteDataResponseDto })
  @ApiNotFoundResponse({ description: 'Orçamento inexistente ou não vinculado' })
  getQuote(
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MyQuoteDataResponseDto> {
    return this.controller.getQuote(principal.sub, quoteId);
  }

  @Post('quotes/:quoteId/decisions')
  @CustomerArea()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprovar ou rejeitar um orçamento vinculado' })
  @ApiParam({ name: 'quoteId', format: 'uuid' })
  @ApiOkResponse({ type: MyQuoteDataResponseDto })
  @ApiNotFoundResponse({ description: 'Orçamento inexistente ou não vinculado' })
  @ApiBadRequestResponse({ description: 'Justificativa ausente na rejeição' })
  @ApiConflictResponse({ description: 'Transição de status inválida para o orçamento' })
  decideQuote(
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Body() request: DecideMyQuoteRequestDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MyQuoteDataResponseDto> {
    return this.controller.decideQuote(principal.sub, quoteId, request);
  }
}
