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
import { ApproveQuoteUseCase } from '@application/use-cases/quote/approve-quote.use-case';
import { RejectQuoteUseCase } from '@application/use-cases/quote/reject-quote.use-case';
import { UpdateQuoteStatusUseCase } from '@application/use-cases/quote/update-quote-status.use-case';
import { FindAllQuotesPaginatedUseCase } from '@application/use-cases/quote/find-all-quotes-paginated.use-case';
import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';

import { QuoteController as QuoteCleanController } from '@interface-adapters/quote/quote.controller';
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
          new CreateQuoteUseCase(unitOfWork),
          new FindQuoteByIdUseCase(quoteRepository),
          new AddQuoteServiceUseCase(unitOfWork),
          new RemoveQuoteServiceUseCase(unitOfWork),
          new AddQuotePartSupplyUseCase(unitOfWork),
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
      ],
    },
  ],
})
export class QuoteModule {}
