import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import {
  HEALTH_SEGMENT,
  HEALTHY_BODY,
  LIVENESS_SEGMENT,
  READINESS_SEGMENT,
  UNAVAILABLE_BODY,
} from '@infrastructure/health/health.constants';
import { ReadinessState } from '@infrastructure/health/readiness-state';
import { Public } from '@infrastructure/http/decorators/public.decorator';

import { HealthyResponseDto, UnavailableResponseDto } from './dto/responses/health-response.dto';

const CACHE_CONTROL_HEADER = 'Cache-Control';
const CACHE_CONTROL_VALUE = 'no-store';

@ApiTags('Health')
@ApiProduces('application/json')
@Public()
@Controller(HEALTH_SEGMENT)
export class HealthController {
  constructor(private readonly readiness: ReadinessState) {}

  @Get(LIVENESS_SEGMENT)
  @ApiOperation({
    summary: 'Vivacidade (público)',
    description: 'Verifica se a aplicação está em execução e respondendo.',
  })
  @ApiOkResponse({ type: HealthyResponseDto, description: 'Aplicação em execução' })
  @ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
  live(@Res({ passthrough: true }) response: Response): HealthyResponseDto {
    response.setHeader(CACHE_CONTROL_HEADER, CACHE_CONTROL_VALUE);

    return HEALTHY_BODY;
  }

  @Get(READINESS_SEGMENT)
  @ApiOperation({
    summary: 'Prontidão (público)',
    description:
      'Verifica se a aplicação está apta a receber tráfego: as dependências essenciais ' +
      'respondem e a instância não está encerrando.',
  })
  @ApiOkResponse({ type: HealthyResponseDto, description: 'Aplicação apta a receber tráfego' })
  @ApiServiceUnavailableResponse({
    type: UnavailableResponseDto,
    description: 'Aplicação indisponível para receber tráfego',
  })
  @ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
  async ready(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthyResponseDto | UnavailableResponseDto> {
    response.setHeader(CACHE_CONTROL_HEADER, CACHE_CONTROL_VALUE);

    if (await this.readiness.isReady()) {
      return HEALTHY_BODY;
    }

    response.status(HttpStatus.SERVICE_UNAVAILABLE);

    return UNAVAILABLE_BODY;
  }
}
