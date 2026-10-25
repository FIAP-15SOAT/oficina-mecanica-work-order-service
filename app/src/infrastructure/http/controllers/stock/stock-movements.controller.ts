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

import { StockMovementPaginatedResponseDto } from './dto/responses/stock-movement-response.dto';
import { FindStockMovementsQueryDto } from './dto/requests/filter-stock-movements.dto';

@ApiTags('Estoque - Movimentações')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@Controller('stock-movements')
@UseGuards(RolesGuard)
@ApiBearerAuth('access-token')
export class StockMovementsController {
  constructor(private readonly controller: StockController) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Listar movimentações de estoque' })
  @ApiOkResponse({
    type: StockMovementPaginatedResponseDto,
    description: 'Lista paginada de movimentações',
  })
  @ApiUnauthorizedResponse({ description: 'Não autenticado' })
  getStockMovements(
    @Query() query: FindStockMovementsQueryDto,
  ): Promise<StockMovementPaginatedResponseDto> {
    return this.controller.getStockMovements(query);
  }
}
