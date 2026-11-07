import { PaginationMeta } from '@domain/interfaces/common/pagination.interface';

export interface ServiceMetricsResponse {
  serviceId: string;
  serviceName: string | null;
  executionCount: number;
  averageTimeMinutes: number;
}

export interface ServiceMetricsDataResponse {
  data: ServiceMetricsResponse;
}

export interface ServiceMetricsPaginatedResponse {
  data: ServiceMetricsResponse[];
  pagination: PaginationMeta;
}
