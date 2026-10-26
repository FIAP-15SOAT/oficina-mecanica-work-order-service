import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { RolesGuard } from '@infrastructure/http/guards/roles.guard';
import { Roles } from '@infrastructure/http/decorators/roles.decorator';
import { UserRole } from '@domain/enums/user-role.enum';

import { StockController } from '@interface-adapters/stock/stock.controller';

import { StockReservationPaginatedResponseDto } from './dto/responses/stock-reservation-response.dto';
import { FindStockReservationsQueryDto } from './dto/requests/filter-stock-reservations.dto';

@ApiTags('Estoque - Reservas')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@Controller('stock-reservations')
@UseGuards(RolesGuard)
@ApiBearerAuth('access-token')
export class StockReservationsController {
  constructor(private readonly controller: StockController) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Listar reservas de estoque' })
  @ApiOkResponse({
    type: StockReservationPaginatedResponseDto,
    description: 'Lista paginada de reservas',
  })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  getStockReservations(
    @Query() query: FindStockReservationsQueryDto,
  ): Promise<StockReservationPaginatedResponseDto> {
    return this.controller.getStockReservations(query);
  }
}
