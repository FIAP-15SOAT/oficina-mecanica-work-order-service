import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ServiceMetrics } from '@application/ports/input/service/dto/find-service-metrics.dto';
import { IFindServiceMetricsUseCase } from '@application/ports/input/service/find-service-metrics.use-case.interface';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';

export class FindServiceMetricsUseCase implements IFindServiceMetricsUseCase {
  constructor(
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly inventoryCatalogGateway: IInventoryCatalogGateway,
  ) {}

  async execute(serviceId: string): Promise<ServiceMetrics> {
    const [service] = await this.inventoryCatalogGateway.findServicesByIds([serviceId]);

    if (!service) {
      throw new ResourceNotFoundException('Serviço', serviceId);
    }

    const metrics = await this.workOrderRepository.findServiceExecutionMetrics(serviceId);

    return {
      ...metrics,
      serviceName: service.name,
      averageTimeMinutes: metrics.averageTimeMinutes ?? 0,
    };
  }
}
