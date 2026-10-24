import { Module } from '@nestjs/common';

import { CreateWorkOrderUseCase } from '@application/use-cases/work-order/create-work-order.use-case';
import { FindWorkOrderByIdUseCase } from '@application/use-cases/work-order/find-work-order-by-id.use-case';
import { FindAllWorkOrdersPaginatedUseCase } from '@application/use-cases/work-order/find-all-work-orders-paginated.use-case';
import { UpdateWorkOrderUseCase } from '@application/use-cases/work-order/update-work-order.use-case';
import { UpdateWorkOrderStatusUseCase } from '@application/use-cases/work-order/update-work-order-status.use-case';
import { UpdateWorkOrderServiceStatusUseCase } from '@application/use-cases/work-order/update-work-order-service-status.use-case';
import { FindWorkOrderStatusHistoryUseCase } from '@application/use-cases/work-order/find-work-order-status-history.use-case';
import { FindWorkOrderQuotesUseCase } from '@application/use-cases/quote/find-work-order-quotes.use-case';

import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { IMetrics } from '@application/ports/output/metrics.service.interface';
import { ICache } from '@application/ports/output/cache.service.interface';
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
        quoteRepository: IQuoteRepository,
        logger: ILogger,
        metrics: IMetrics,
        cache: ICache,
      ) =>
        new WorkOrderCleanController(
          new CreateWorkOrderUseCase(unitOfWork, metrics),
          new FindWorkOrderByIdUseCase(workOrderRepository, userRepository, cache),
          new FindAllWorkOrdersPaginatedUseCase(workOrderRepository),
          new UpdateWorkOrderUseCase(workOrderRepository, userRepository, cache),
          new UpdateWorkOrderStatusUseCase(
            unitOfWork,
            logger.forContext(UpdateWorkOrderStatusUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
          ),
          new UpdateWorkOrderServiceStatusUseCase(
            unitOfWork,
            logger.forContext(UpdateWorkOrderServiceStatusUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
          ),
          new FindWorkOrderStatusHistoryUseCase(statusHistoryRepository, workOrderRepository),
          new FindWorkOrderQuotesUseCase(quoteRepository, workOrderRepository),
        ),
      inject: [
        'IUnitOfWork',
        'IWorkOrderRepository',
        'IUserRepository',
        'IStatusHistoryRepository',
        'IQuoteRepository',
        'ILogger',
        'IMetrics',
        'ICache',
      ],
    },
  ],
})
export class WorkOrderModule {}
