import { PaginatedResult } from '@domain/interfaces/common/pagination.interface';
import { ServiceMetrics } from '@application/ports/input/service/dto/find-service-metrics.dto';
import {
  ServiceMetricsDataResponse,
  ServiceMetricsPaginatedResponse,
  ServiceMetricsResponse,
} from './responses/service-metrics.response';

export class ServiceMetricsPresenter {
  static toResponse(metrics: ServiceMetrics): ServiceMetricsResponse {
    return {
      serviceId: metrics.serviceId,
      serviceName: metrics.serviceName,
      executionCount: metrics.executionCount,
      averageTimeMinutes: metrics.averageTimeMinutes,
    };
  }

  static toDataResponse(metrics: ServiceMetrics): ServiceMetricsDataResponse {
    return { data: ServiceMetricsPresenter.toResponse(metrics) };
  }

  static toPaginatedDataResponse(
    result: PaginatedResult<ServiceMetrics>,
  ): ServiceMetricsPaginatedResponse {
    return {
      data: result.items.map((m) => ServiceMetricsPresenter.toResponse(m)),
      pagination: result.pagination,
    };
  }
}
