import { Module } from '@nestjs/common';

import { CreateServiceUseCase } from '@application/use-cases/service/create-service.use-case';
import { UpdateServiceUseCase } from '@application/use-cases/service/update-service.use-case';
import { FindServiceByIdUseCase } from '@application/use-cases/service/find-service-by-id.use-case';
import { FindAllServicesPaginatedUseCase } from '@application/use-cases/service/find-all-services-paginated.use-case';
import { DeleteServiceUseCase } from '@application/use-cases/service/delete-service.use-case';
import { FindServiceMetricsUseCase } from '@application/use-cases/service/find-service-metrics.use-case';
import { FindAllServicesMetricsUseCase } from '@application/use-cases/service/find-all-services-metrics.use-case';

import { IServiceRepository } from '@domain/interfaces/repositories/service.repository.interface';
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
        serviceRepository: IServiceRepository,
        workOrderRepository: IWorkOrderRepository,
        inventoryCatalogGateway: IInventoryCatalogGateway,
      ) =>
        new ServiceCleanController(
          new CreateServiceUseCase(serviceRepository),
          new FindServiceByIdUseCase(serviceRepository),
          new FindAllServicesPaginatedUseCase(serviceRepository),
          new UpdateServiceUseCase(serviceRepository),
          new DeleteServiceUseCase(serviceRepository),
          new FindServiceMetricsUseCase(workOrderRepository, inventoryCatalogGateway),
          new FindAllServicesMetricsUseCase(workOrderRepository, inventoryCatalogGateway),
        ),
      inject: ['IServiceRepository', 'IWorkOrderRepository', 'IInventoryCatalogGateway'],
    },
  ],
})
export class ServiceModule {}
