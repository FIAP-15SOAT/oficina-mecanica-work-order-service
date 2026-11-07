import { Quote } from '@domain/entities/quote.entity';

import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { QuoteItemValidator } from '@application/services/quote-item-validator';

import { CreateQuoteDto } from '@application/ports/input/quote/dto/create-quote.dto';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';

export class CreateQuoteUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly quoteItemValidator: QuoteItemValidator,
  ) {}

  async execute(dto: CreateQuoteDto): Promise<Quote> {
    const { services, partsSupplies } = await this.quoteItemValidator.validateAndResolve(
      dto.services ?? [],
      dto.partsSupplies ?? [],
    );

    return this.unitOfWork.executeTransaction(async (repos) => {
      const workOrder = await repos.workOrder.findById(dto.workOrderId);

      if (!workOrder) {
        throw new ResourceNotFoundException('Ordem de Serviço', dto.workOrderId);
      }

      workOrder.ensureCanCreateQuote();

      const quote = Quote.create({
        workOrderId: dto.workOrderId,
        notes: dto.notes,
        services,
        partsSupplies,
      });

      return repos.quote.create(quote);
    });
  }
}
