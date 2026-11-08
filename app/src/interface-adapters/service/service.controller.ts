import { IFindServiceMetricsUseCase } from '@application/ports/input/service/find-service-metrics.use-case.interface';
import { IFindAllServicesMetricsUseCase } from '@application/ports/input/service/find-all-services-metrics.use-case.interface';

import { FindAllServicesMetricsQuery } from './requests/find-all-services-metrics-query';

import { ServiceMetricsPresenter } from './service-metrics.presenter';
import {
  ServiceMetricsDataResponse,
  ServiceMetricsPaginatedResponse,
} from './responses/service-metrics.response';

export class ServiceController {
  constructor(
    private readonly findServiceMetricsUseCase: IFindServiceMetricsUseCase,
    private readonly findAllServicesMetricsUseCase: IFindAllServicesMetricsUseCase,
  ) {}

  async getMetrics(id: string): Promise<ServiceMetricsDataResponse> {
    const metrics = await this.findServiceMetricsUseCase.execute(id);
    return ServiceMetricsPresenter.toDataResponse(metrics);
  }

  async getAllMetrics(
    query: FindAllServicesMetricsQuery,
  ): Promise<ServiceMetricsPaginatedResponse> {
    const result = await this.findAllServicesMetricsUseCase.execute({
      page: query.page ?? 1,
      limit: query.limit ?? 10,
    });

    return ServiceMetricsPresenter.toPaginatedDataResponse(result);
  }
}
