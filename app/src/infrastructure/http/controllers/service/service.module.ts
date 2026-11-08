import { Module } from '@nestjs/common';

import { FindServiceMetricsUseCase } from '@application/use-cases/service/find-service-metrics.use-case';
import { FindAllServicesMetricsUseCase } from '@application/use-cases/service/find-all-services-metrics.use-case';

import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';

import { ServiceController as ServiceCleanController } from '@interface-adapters/service/service.controller';
import { ServiceController } from './service.controller';
import { ServicesMetricsController } from './services-metrics.controller';

@Module({
  controllers: [ServiceController, ServicesMetricsController],
  providers: [
    {
      provide: ServiceCleanController,
      useFactory: (
        workOrderRepository: IWorkOrderRepository,
        inventoryCatalogGateway: IInventoryCatalogGateway,
      ) =>
        new ServiceCleanController(
          new FindServiceMetricsUseCase(workOrderRepository, inventoryCatalogGateway),
          new FindAllServicesMetricsUseCase(workOrderRepository, inventoryCatalogGateway),
        ),
      inject: ['IWorkOrderRepository', 'IInventoryCatalogGateway'],
    },
  ],
})
export class ServiceModule {}
