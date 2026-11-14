import { Module } from '@nestjs/common';

import { CreateWorkOrderUseCase } from '@application/use-cases/work-order/create-work-order.use-case';
import { FindWorkOrderByIdUseCase } from '@application/use-cases/work-order/find-work-order-by-id.use-case';
import { FindAllWorkOrdersPaginatedUseCase } from '@application/use-cases/work-order/find-all-work-orders-paginated.use-case';
import { UpdateWorkOrderUseCase } from '@application/use-cases/work-order/update-work-order.use-case';
import { UpdateWorkOrderStatusUseCase } from '@application/use-cases/work-order/update-work-order-status.use-case';
import { UpdateWorkOrderServiceStatusUseCase } from '@application/use-cases/work-order/update-work-order-service-status.use-case';
import { FindWorkOrderStatusHistoryUseCase } from '@application/use-cases/work-order/find-work-order-status-history.use-case';
import { FindUsersByIdsUseCase } from '@application/use-cases/identity/find-users-by-ids.use-case';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { FindCatalogItemsUseCase } from '@application/use-cases/catalog/find-catalog-items.use-case';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { IBillingPaymentsGateway } from '@application/ports/output/gateways/billing/billing-payments-gateway.interface';
import { MechanicAssignmentPolicy } from '@application/policies/mechanic-assignment.policy';

import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IVehicleRepository } from '@domain/interfaces/repositories/vehicle.repository.interface';
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
        statusHistoryRepository: IStatusHistoryRepository,
        logger: ILogger,
        metrics: IMetrics,
        cache: ICache,
        inventoryCatalogGateway: IInventoryCatalogGateway,
        customerRepository: ICustomerRepository,
        vehicleRepository: IVehicleRepository,
        billingQuotesGateway: IBillingQuotesGateway,
        billingPaymentsGateway: IBillingPaymentsGateway,
        identityUsersGateway: IIdentityUsersGateway,
      ) => {
        const mechanicAssignmentPolicy = new MechanicAssignmentPolicy(identityUsersGateway);

        return new WorkOrderCleanController(
          new CreateWorkOrderUseCase(
            unitOfWork,
            customerRepository,
            vehicleRepository,
            mechanicAssignmentPolicy,
            billingQuotesGateway,
            logger.forContext(CreateWorkOrderUseCase.name),
            metrics,
          ),
          new FindWorkOrderByIdUseCase(workOrderRepository, cache),
          new FindAllWorkOrdersPaginatedUseCase(workOrderRepository),
          new UpdateWorkOrderUseCase(workOrderRepository, mechanicAssignmentPolicy, cache),
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
          new FindUsersByIdsUseCase(identityUsersGateway),
        );
      },
      inject: [
        'IUnitOfWork',
        'IWorkOrderRepository',
        'IStatusHistoryRepository',
        'ILogger',
        'IMetrics',
        'ICache',
        'IInventoryCatalogGateway',
        'ICustomerRepository',
        'IVehicleRepository',
        'IBillingQuotesGateway',
        'IBillingPaymentsGateway',
        'IIdentityUsersGateway',
      ],
    },
  ],
  exports: [WorkOrderCleanController],
})
export class WorkOrderModule {}
