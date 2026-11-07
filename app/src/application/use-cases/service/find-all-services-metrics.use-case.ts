import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { PaginatedResult, PaginationInput } from '@domain/interfaces/common/pagination.interface';
import { ServiceMetrics } from '@application/ports/input/service/dto/find-service-metrics.dto';
import { IFindAllServicesMetricsUseCase } from '@application/ports/input/service/find-all-services-metrics.use-case.interface';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { buildPaginatedResult } from '@application/utils/pagination.util';

export class FindAllServicesMetricsUseCase implements IFindAllServicesMetricsUseCase {
  constructor(
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly inventoryCatalogGateway: IInventoryCatalogGateway,
  ) {}

  async execute(input: PaginationInput): Promise<PaginatedResult<ServiceMetrics>> {
    const executions = await this.workOrderRepository.findAllServiceExecutionMetrics();

    const services = await this.inventoryCatalogGateway.findServicesByIds(
      executions.map(({ serviceId }) => serviceId),
    );

    const names = new Map(services.map((service) => [service.id, service.name]));

    // The service name lives in the Inventory, so sorting and paging happen here.
    const metrics = executions
      .map((execution) => ({
        ...execution,
        serviceName: names.get(execution.serviceId) ?? null,
        averageTimeMinutes: execution.averageTimeMinutes ?? 0,
      }))
      .sort(byNameWithUnknownLast);

    const start = (input.page - 1) * input.limit;

    return buildPaginatedResult(
      { items: metrics.slice(start, start + input.limit), total: metrics.length },
      input,
    );
  }
}

function byNameWithUnknownLast(a: ServiceMetrics, b: ServiceMetrics): number {
  if (a.serviceName === null || b.serviceName === null) {
    return Number(a.serviceName === null) - Number(b.serviceName === null);
  }

  return a.serviceName.localeCompare(b.serviceName);
}
