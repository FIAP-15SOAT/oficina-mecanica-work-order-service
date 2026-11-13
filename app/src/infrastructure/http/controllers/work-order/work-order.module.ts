import { Module } from '@nestjs/common';

import { CreateWorkOrderUseCase } from '@application/use-cases/work-order/create-work-order.use-case';
import { FindWorkOrderByIdUseCase } from '@application/use-cases/work-order/find-work-order-by-id.use-case';
import { FindAllWorkOrdersPaginatedUseCase } from '@application/use-cases/work-order/find-all-work-orders-paginated.use-case';
import { UpdateWorkOrderUseCase } from '@application/use-cases/work-order/update-work-order.use-case';
import { UpdateWorkOrderStatusUseCase } from '@application/use-cases/work-order/update-work-order-status.use-case';
import { UpdateWorkOrderServiceStatusUseCase } from '@application/use-cases/work-order/update-work-order-service-status.use-case';
import { FindWorkOrderStatusHistoryUseCase } from '@application/use-cases/work-order/find-work-order-status-history.use-case';
import { FindCatalogItemsUseCase } from '@application/use-cases/catalog/find-catalog-items.use-case';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { IBillingPaymentsGateway } from '@application/ports/output/gateways/billing/billing-payments-gateway.interface';

import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IVehicleRepository } from '@domain/interfaces/repositories/vehicle.repository.interface';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { WorkOrderController as WorkOrderCleanController } from '@interface-adapters/work-order/work-order.controller';
import { WorkOrderController } from './work-order.controller';

@Module({
  controllers: [WorkOrderController],
  providers: [
    {
      provide: WorkOrderCleanController,
      useFactory: (
        unitOfWork: IUnitOfWork,
        workOrderRepository: IWorkOrderRepository,
        userRepository: IUserRepository,
        statusHistoryRepository: IStatusHistoryRepository,
        logger: ILogger,
        metrics: IMetrics,
        cache: ICache,
        inventoryCatalogGateway: IInventoryCatalogGateway,
        customerRepository: ICustomerRepository,
        vehicleRepository: IVehicleRepository,
        billingQuotesGateway: IBillingQuotesGateway,
        billingPaymentsGateway: IBillingPaymentsGateway,
      ) =>
        new WorkOrderCleanController(
          new CreateWorkOrderUseCase(
            unitOfWork,
            customerRepository,
            vehicleRepository,
            userRepository,
            billingQuotesGateway,
            logger.forContext(CreateWorkOrderUseCase.name),
            metrics,
          ),
          new FindWorkOrderByIdUseCase(workOrderRepository, userRepository, cache),
          new FindAllWorkOrdersPaginatedUseCase(workOrderRepository),
          new UpdateWorkOrderUseCase(workOrderRepository, userRepository, cache),
          new UpdateWorkOrderStatusUseCase(
            unitOfWork,
            logger.forContext(UpdateWorkOrderStatusUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
            workOrderRepository,
            billingPaymentsGateway,
          ),
          new UpdateWorkOrderServiceStatusUseCase(
            unitOfWork,
            logger.forContext(UpdateWorkOrderServiceStatusUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
          ),
          new FindWorkOrderStatusHistoryUseCase(statusHistoryRepository, workOrderRepository),
          new FindCatalogItemsUseCase(inventoryCatalogGateway),
        ),
      inject: [
        'IUnitOfWork',
        'IWorkOrderRepository',
        'IUserRepository',
        'IStatusHistoryRepository',
        'ILogger',
        'IMetrics',
        'ICache',
        'IInventoryCatalogGateway',
        'ICustomerRepository',
        'IVehicleRepository',
        'IBillingQuotesGateway',
        'IBillingPaymentsGateway',
      ],
    },
  ],
  exports: [WorkOrderCleanController],
})
export class WorkOrderModule {}
