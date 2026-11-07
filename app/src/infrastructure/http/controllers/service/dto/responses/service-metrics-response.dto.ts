import { ApiProperty } from '@nestjs/swagger';
import { PaginatedResponseDto } from '@infrastructure/http/common/dto/paginated-response.dto';
import {
  ServiceMetricsDataResponse,
  ServiceMetricsPaginatedResponse,
  ServiceMetricsResponse,
} from '@interface-adapters/service/responses/service-metrics.response';

export class ServiceMetricsResponseDto implements ServiceMetricsResponse {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', format: 'uuid' })
  serviceId!: string;

  @ApiProperty({ example: 'Troca de óleo', nullable: true })
  serviceName!: string | null;

  @ApiProperty({ example: 10 })
  executionCount!: number;

  @ApiProperty({ example: 45 })
  averageTimeMinutes!: number;
}

export class ServiceMetricsDataResponseDto implements ServiceMetricsDataResponse {
  @ApiProperty({ type: ServiceMetricsResponseDto })
  data!: ServiceMetricsResponseDto;
}

export class ServiceMetricsPaginatedResponseDto
  extends PaginatedResponseDto<ServiceMetricsResponseDto>
  implements ServiceMetricsPaginatedResponse
{
  @ApiProperty({ type: [ServiceMetricsResponseDto] })
  data!: ServiceMetricsResponseDto[];
}
