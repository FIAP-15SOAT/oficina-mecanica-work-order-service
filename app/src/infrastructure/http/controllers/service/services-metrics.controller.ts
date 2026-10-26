import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '@infrastructure/http/decorators/roles.decorator';
import { RolesGuard } from '@infrastructure/http/guards/roles.guard';
import { UserRole } from '@domain/enums/user-role.enum';

import { ServiceController as ServiceCleanController } from '@interface-adapters/service/service.controller';

import { PaginationDto } from '@infrastructure/http/common/dto/pagination.dto';
import { ServiceMetricsPaginatedResponseDto } from './dto/responses/service-metrics-response.dto';

@ApiTags('Gestão de Serviços - Métricas')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@Controller('services-metrics')
@UseGuards(RolesGuard)
@ApiBearerAuth('access-token')
export class ServicesMetricsController {
  constructor(private readonly controller: ServiceCleanController) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Obter métricas de todos os serviços' })
  @ApiOkResponse({
    type: ServiceMetricsPaginatedResponseDto,
    description: 'Lista paginada de métricas de todos os serviços',
  })
  getAllMetrics(@Query() query: PaginationDto): Promise<ServiceMetricsPaginatedResponseDto> {
    return this.controller.getAllMetrics(query);
  }
}
