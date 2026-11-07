import { ServiceMetrics } from '@application/ports/input/service/dto/find-service-metrics.dto';

export interface IFindServiceMetricsUseCase {
  execute(serviceId: string): Promise<ServiceMetrics>;
}
