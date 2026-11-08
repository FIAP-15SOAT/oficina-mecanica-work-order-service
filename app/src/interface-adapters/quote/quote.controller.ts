import { ICreateQuoteUseCase } from '@application/ports/input/quote/create-quote.use-case.interface';
import { IFindQuoteByIdUseCase } from '@application/ports/input/quote/find-quote-by-id.use-case.interface';
import { IAddQuoteServiceUseCase } from '@application/ports/input/quote/add-quote-service.use-case.interface';
import { IRemoveQuoteServiceUseCase } from '@application/ports/input/quote/remove-quote-service.use-case.interface';
import { IAddQuotePartSupplyUseCase } from '@application/ports/input/quote/add-quote-part-supply.use-case.interface';
import { IRemoveQuotePartSupplyUseCase } from '@application/ports/input/quote/remove-quote-part-supply.use-case.interface';
import { IUpdateQuoteServiceQuantityUseCase } from '@application/ports/input/quote/update-quote-service-quantity.use-case.interface';
import { IUpdateQuotePartSupplyQuantityUseCase } from '@application/ports/input/quote/update-quote-part-supply-quantity.use-case.interface';
import { ISubmitQuoteUseCase } from '@application/ports/input/quote/submit-quote.use-case.interface';
import { IUpdateQuoteStatusUseCase } from '@application/ports/input/quote/update-quote-status.use-case.interface';
import { IFindAllQuotesPaginatedUseCase } from '@application/ports/input/quote/find-all-quotes-paginated.use-case.interface';
import { IFindCatalogItemsUseCase } from '@application/ports/input/catalog/find-catalog-items.use-case.interface';

import { CreateQuoteRequest } from './requests/create-quote-request';
import { AddQuoteServiceRequest } from './requests/add-quote-service-request';
import { AddQuotePartSupplyRequest } from './requests/add-quote-part-supply-request';
import { UpdateQuoteServiceItemRequest } from './requests/update-quote-service-item-request';
import { UpdateQuotePartSupplyItemRequest } from './requests/update-quote-part-supply-item-request';
import { UpdateQuoteStatusRequest } from './requests/update-quote-status-request';
import { FindAllQuotesQuery } from './requests/find-all-quotes-query';

import { QuotePresenter } from './quote.presenter';
import {
  QuoteDataResponse,
  QuoteWithItemsDataResponse,
  QuotePaginatedResponse,
} from './responses/quote.response';

export class QuoteController {
  constructor(
    private readonly createQuoteUseCase: ICreateQuoteUseCase,
    private readonly findQuoteByIdUseCase: IFindQuoteByIdUseCase,
    private readonly addQuoteServiceUseCase: IAddQuoteServiceUseCase,
    private readonly removeQuoteServiceUseCase: IRemoveQuoteServiceUseCase,
    private readonly addQuotePartSupplyUseCase: IAddQuotePartSupplyUseCase,
    private readonly removeQuotePartSupplyUseCase: IRemoveQuotePartSupplyUseCase,
    private readonly updateQuoteServiceQuantityUseCase: IUpdateQuoteServiceQuantityUseCase,
    private readonly updateQuotePartSupplyQuantityUseCase: IUpdateQuotePartSupplyQuantityUseCase,
    private readonly submitQuoteUseCase: ISubmitQuoteUseCase,
    private readonly updateQuoteStatusUseCase: IUpdateQuoteStatusUseCase,
    private readonly findAllQuotesPaginatedUseCase: IFindAllQuotesPaginatedUseCase,
    private readonly findCatalogItemsUseCase: IFindCatalogItemsUseCase,
  ) {}

  async findAll(query: FindAllQuotesQuery): Promise<QuotePaginatedResponse> {
    const result = await this.findAllQuotesPaginatedUseCase.execute({
      ...query,
      page: query.page ?? 1,
      limit: query.limit ?? 10,
    });

    return QuotePresenter.toPaginatedResponse(result);
  }

  async create(input: CreateQuoteRequest): Promise<QuoteDataResponse> {
    const quote = await this.createQuoteUseCase.execute(input);
    return QuotePresenter.toDataResponse(quote);
  }

  async findOne(id: string): Promise<QuoteWithItemsDataResponse> {
    const quote = await this.findQuoteByIdUseCase.execute(id);

    const catalog = await this.findCatalogItemsUseCase.execute({
      serviceIds: quote.services.map((item) => item.serviceId),
      partSupplyIds: quote.partsSupplies.map((item) => item.partSupplyId),
    });

    return QuotePresenter.toWithItemsResponse(quote, catalog);
  }

  async addService(quoteId: string, input: AddQuoteServiceRequest): Promise<QuoteDataResponse> {
    const quote = await this.addQuoteServiceUseCase.execute({ quoteId, ...input });
    return QuotePresenter.toDataResponse(quote);
  }

  async updateService(
    quoteId: string,
    serviceId: string,
    input: UpdateQuoteServiceItemRequest,
  ): Promise<QuoteDataResponse> {
    const quote = await this.updateQuoteServiceQuantityUseCase.execute({
      quoteId,
      serviceId,
      ...input,
    });
    return QuotePresenter.toDataResponse(quote);
  }

  async removeService(quoteId: string, serviceId: string): Promise<void> {
    await this.removeQuoteServiceUseCase.execute(quoteId, serviceId);
  }

  async addPartSupply(
    quoteId: string,
    input: AddQuotePartSupplyRequest,
  ): Promise<QuoteDataResponse> {
    const quote = await this.addQuotePartSupplyUseCase.execute({ quoteId, ...input });
    return QuotePresenter.toDataResponse(quote);
  }

  async updatePartSupply(
    quoteId: string,
    partSupplyId: string,
    input: UpdateQuotePartSupplyItemRequest,
  ): Promise<QuoteDataResponse> {
    const quote = await this.updateQuotePartSupplyQuantityUseCase.execute({
      quoteId,
      partSupplyId,
      ...input,
    });
    return QuotePresenter.toDataResponse(quote);
  }

  async removePartSupply(quoteId: string, partSupplyId: string): Promise<void> {
    await this.removeQuotePartSupplyUseCase.execute(quoteId, partSupplyId);
  }

  async submit(id: string): Promise<QuoteDataResponse> {
    const quote = await this.submitQuoteUseCase.execute(id);
    return QuotePresenter.toDataResponse(quote);
  }

  async updateStatus(
    id: string,
    userId: string,
    input: UpdateQuoteStatusRequest,
  ): Promise<QuoteDataResponse> {
    const quote = await this.updateQuoteStatusUseCase.execute(id, userId, input);
    return QuotePresenter.toDataResponse(quote);
  }
}
