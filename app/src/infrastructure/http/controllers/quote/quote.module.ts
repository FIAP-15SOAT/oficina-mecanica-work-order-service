import { Module } from '@nestjs/common';

import { CreateQuoteUseCase } from '@application/use-cases/quote/create-quote.use-case';
import { FindQuoteByIdUseCase } from '@application/use-cases/quote/find-quote-by-id.use-case';
import { AddQuoteServiceUseCase } from '@application/use-cases/quote/add-quote-service.use-case';
import { RemoveQuoteServiceUseCase } from '@application/use-cases/quote/remove-quote-service.use-case';
import { AddQuotePartSupplyUseCase } from '@application/use-cases/quote/add-quote-part-supply.use-case';
import { RemoveQuotePartSupplyUseCase } from '@application/use-cases/quote/remove-quote-part-supply.use-case';
import { UpdateQuoteServiceQuantityUseCase } from '@application/use-cases/quote/update-quote-service-quantity.use-case';
import { UpdateQuotePartSupplyQuantityUseCase } from '@application/use-cases/quote/update-quote-part-supply-quantity.use-case';
import { SubmitQuoteUseCase } from '@application/use-cases/quote/submit-quote.use-case';
import { ApproveQuoteUseCase } from '@application/use-cases/quote-approval/approve-quote.use-case';
import { CompleteQuoteApprovalUseCase } from '@application/use-cases/quote-approval/complete-quote-approval.use-case';
import { CompensateQuoteApprovalUseCase } from '@application/use-cases/quote-approval/compensate-quote-approval.use-case';
import { RejectQuoteUseCase } from '@application/use-cases/quote/reject-quote.use-case';
import { UpdateQuoteStatusUseCase } from '@application/use-cases/quote/update-quote-status.use-case';
import { FindAllQuotesPaginatedUseCase } from '@application/use-cases/quote/find-all-quotes-paginated.use-case';
import { CheckServiceQuoteUsageUseCase } from '@application/use-cases/quote/check-service-quote-usage.use-case';
import { CheckPartSupplyQuoteUsageUseCase } from '@application/use-cases/quote/check-part-supply-quote-usage.use-case';
import { FindCatalogItemsUseCase } from '@application/use-cases/catalog/find-catalog-items.use-case';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { QuoteItemValidator } from '@application/services/quote-item-validator';
import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';

import { QuoteController as QuoteCleanController } from '@interface-adapters/quote/quote.controller';
import { InternalQuoteController as InternalQuoteCleanController } from '@interface-adapters/quote/internal-quote.controller';
import { QuoteApprovalMessageHandlers } from '@infrastructure/messaging/handlers/quote-approval-message-handlers';
import { QuoteController } from './quote.controller';

@Module({
  imports: [InfrastructureServicesModule],
  controllers: [QuoteController],
  providers: [
    {
      provide: QuoteCleanController,
      useFactory: (
        unitOfWork: IUnitOfWork,
        quoteRepository: IQuoteRepository,
        emailSender: IEmailSenderService,
        logger: ILogger,
        metrics: IMetrics,
        statusHistoryRepository: IStatusHistoryRepository,
        cache: ICache,
        inventoryCatalogGateway: IInventoryCatalogGateway,
      ) => {
        const approveQuoteUseCase = new ApproveQuoteUseCase(
          unitOfWork,
          logger.forContext(ApproveQuoteUseCase.name),
          metrics,
          statusHistoryRepository,
          cache,
        );
        const rejectQuoteUseCase = new RejectQuoteUseCase(
          unitOfWork,
          logger.forContext(RejectQuoteUseCase.name),
          metrics,
          statusHistoryRepository,
          cache,
        );

        return new QuoteCleanController(
          new CreateQuoteUseCase(unitOfWork, new QuoteItemValidator(inventoryCatalogGateway)),
          new FindQuoteByIdUseCase(quoteRepository),
          new AddQuoteServiceUseCase(quoteRepository, unitOfWork, inventoryCatalogGateway),
          new RemoveQuoteServiceUseCase(unitOfWork),
          new AddQuotePartSupplyUseCase(quoteRepository, unitOfWork, inventoryCatalogGateway),
          new RemoveQuotePartSupplyUseCase(unitOfWork),
          new UpdateQuoteServiceQuantityUseCase(unitOfWork),
          new UpdateQuotePartSupplyQuantityUseCase(unitOfWork),
          new SubmitQuoteUseCase(
            unitOfWork,
            emailSender,
            logger.forContext(SubmitQuoteUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
          ),
          new UpdateQuoteStatusUseCase(approveQuoteUseCase, rejectQuoteUseCase),
          new FindAllQuotesPaginatedUseCase(quoteRepository),
          new FindCatalogItemsUseCase(inventoryCatalogGateway),
        );
      },
      inject: [
        'IUnitOfWork',
        'IQuoteRepository',
        'IEmailSenderService',
        'ILogger',
        'IMetrics',
        'IStatusHistoryRepository',
        'ICache',
        'IInventoryCatalogGateway',
      ],
    },
    {
      provide: InternalQuoteCleanController,
      useFactory: (quoteRepository: IQuoteRepository) =>
        new InternalQuoteCleanController(
          new CheckServiceQuoteUsageUseCase(quoteRepository),
          new CheckPartSupplyQuoteUsageUseCase(quoteRepository),
        ),
      inject: ['IQuoteRepository'],
    },
    {
      provide: CompleteQuoteApprovalUseCase,
      useFactory: (
        unitOfWork: IUnitOfWork,
        logger: ILogger,
        metrics: IMetrics,
        statusHistoryRepository: IStatusHistoryRepository,
        cache: ICache,
      ) =>
        new CompleteQuoteApprovalUseCase(
          unitOfWork,
          logger.forContext(CompleteQuoteApprovalUseCase.name),
          metrics,
          statusHistoryRepository,
          cache,
        ),
      inject: ['IUnitOfWork', 'ILogger', 'IMetrics', 'IStatusHistoryRepository', 'ICache'],
    },
    {
      provide: CompensateQuoteApprovalUseCase,
      useFactory: (unitOfWork: IUnitOfWork, logger: ILogger, emailSender: IEmailSenderService) =>
        new CompensateQuoteApprovalUseCase(
          unitOfWork,
          logger.forContext(CompensateQuoteApprovalUseCase.name),
          emailSender,
        ),
      inject: ['IUnitOfWork', 'ILogger', 'IEmailSenderService'],
    },
    QuoteApprovalMessageHandlers,
  ],
  exports: [InternalQuoteCleanController],
})
export class QuoteModule {}
