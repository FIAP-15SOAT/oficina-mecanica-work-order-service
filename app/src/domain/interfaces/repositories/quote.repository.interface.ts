import { Quote } from '../../entities/quote.entity';
import { QuoteService } from '../../entities/quote-service.entity';
import { QuotePartSupply } from '../../entities/quote-part-supply.entity';
import { QuoteStatus } from '../../enums/quote-status.enum';
import { PaginatedRepositoryResult, PaginationInput } from '../common/pagination.interface';

export interface QuoteFilters {
  workOrderId?: string;
  status?: QuoteStatus;
}

export interface IQuoteRepository {
  create(quote: Quote): Promise<Quote>;
  findById(id: string): Promise<Quote | null>;
  findByIdWithDetails(id: string): Promise<Quote | null>;
  findByWorkOrderId(workOrderId: string): Promise<Quote[]>;
  findAllPaginated(
    pagination: PaginationInput,
    filters: QuoteFilters,
  ): Promise<PaginatedRepositoryResult<Quote>>;
  update(quote: Quote): Promise<Quote>;

  addServiceItem(item: QuoteService): Promise<void>;
  removeServiceItem(quoteId: string, serviceId: string): Promise<void>;
  updateServiceItemQuantity(item: QuoteService): Promise<void>;

  addPartSupplyItem(item: QuotePartSupply): Promise<void>;
  removePartSupplyItem(quoteId: string, partSupplyId: string): Promise<void>;
  updatePartSupplyItemQuantity(item: QuotePartSupply): Promise<void>;

  isServiceInUse(serviceId: string): Promise<boolean>;
  isPartSupplyInUse(partSupplyId: string): Promise<boolean>;
}
