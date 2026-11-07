import { ServiceMetrics } from '@application/ports/input/service/dto/find-service-metrics.dto';
import { PaginatedResult, PaginationInput } from '@domain/interfaces/common/pagination.interface';

export interface IFindAllServicesMetricsUseCase {
  execute(input: PaginationInput): Promise<PaginatedResult<ServiceMetrics>>;
}
