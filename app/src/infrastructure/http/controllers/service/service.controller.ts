import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '@infrastructure/http/decorators/roles.decorator';
import { RolesGuard } from '@infrastructure/http/guards/roles.guard';
import { UserRole } from '@domain/enums/user-role.enum';

import { ServiceController as ServiceCleanController } from '@interface-adapters/service/service.controller';

import { ServiceMetricsDataResponseDto } from './dto/responses/service-metrics-response.dto';

@ApiTags('Gestão de Serviços - Métricas')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@Controller('services')
@UseGuards(RolesGuard)
@ApiBearerAuth('access-token')
export class ServiceController {
  constructor(private readonly controller: ServiceCleanController) {}

  @Get(':id/metrics')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Obter métricas de um serviço específico' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    type: ServiceMetricsDataResponseDto,
    description: 'Métricas do serviço solicitado',
  })
  getMetrics(@Param('id', ParseUUIDPipe) id: string): Promise<ServiceMetricsDataResponseDto> {
    return this.controller.getMetrics(id);
  }
}
