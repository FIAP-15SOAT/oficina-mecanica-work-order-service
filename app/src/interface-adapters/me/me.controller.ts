import { IFindAllMyWorkOrdersUseCase } from '@application/ports/input/me/find-all-my-work-orders.use-case.interface';
import { IFindMyWorkOrderByIdUseCase } from '@application/ports/input/me/find-my-work-order-by-id.use-case.interface';
import { IFindMyWorkOrdersQuotesUseCase } from '@application/ports/input/me/find-my-work-orders-quotes.use-case.interface';
import { IFindMyQuoteByIdUseCase } from '@application/ports/input/me/find-my-quote-by-id.use-case.interface';
import { IDecideMyQuoteUseCase } from '@application/ports/input/me/decide-my-quote.use-case.interface';
import { IFindMyWorkOrderPaymentsUseCase } from '@application/ports/input/me/find-my-work-order-payments.use-case.interface';

import { QuoteDecisionDto } from '@application/ports/input/me/dto/quote-decision.dto';
import { PaginationInput } from '@domain/interfaces/common/pagination.interface';

import { MePresenter } from './me.presenter';
import {
  MyWorkOrderDataResponse,
  MyWorkOrderPaginatedResponse,
  MyQuoteDataResponse,
  MyQuoteListResponse,
  MyPaymentListResponse,
} from './responses/me.response';

export class MeController {
  constructor(
    private readonly findAllMyWorkOrdersUseCase: IFindAllMyWorkOrdersUseCase,
    private readonly findMyWorkOrderByIdUseCase: IFindMyWorkOrderByIdUseCase,
    private readonly findMyWorkOrdersQuotesUseCase: IFindMyWorkOrdersQuotesUseCase,
    private readonly findMyQuoteByIdUseCase: IFindMyQuoteByIdUseCase,
    private readonly decideMyQuoteUseCase: IDecideMyQuoteUseCase,
    private readonly findMyWorkOrderPaymentsUseCase: IFindMyWorkOrderPaymentsUseCase,
  ) {}

  async listWorkOrders(
    userId: string,
    pagination: PaginationInput,
    customerId?: string,
  ): Promise<MyWorkOrderPaginatedResponse> {
    const result = await this.findAllMyWorkOrdersUseCase.execute(userId, pagination, customerId);
    return MePresenter.toWorkOrderPaginatedResponse(result, pagination);
  }

  async getWorkOrder(userId: string, workOrderId: string): Promise<MyWorkOrderDataResponse> {
    const workOrder = await this.findMyWorkOrderByIdUseCase.execute(userId, workOrderId);
    return MePresenter.toWorkOrderDataResponse(workOrder);
  }

  async listWorkOrderQuotes(userId: string, workOrderId: string): Promise<MyQuoteListResponse> {
    const quotes = await this.findMyWorkOrdersQuotesUseCase.execute(userId, workOrderId);
    return MePresenter.toQuoteListResponse(quotes);
  }

  async listWorkOrderPayments(userId: string, workOrderId: string): Promise<MyPaymentListResponse> {
    const payments = await this.findMyWorkOrderPaymentsUseCase.execute(userId, workOrderId);
    return MePresenter.toPaymentListResponse(payments);
  }

  async getQuote(userId: string, quoteId: string): Promise<MyQuoteDataResponse> {
    const quote = await this.findMyQuoteByIdUseCase.execute(userId, quoteId);
    return MePresenter.toQuoteDataResponse(quote);
  }

  async decideQuote(
    userId: string,
    quoteId: string,
    input: QuoteDecisionDto,
  ): Promise<MyQuoteDataResponse> {
    const quote = await this.decideMyQuoteUseCase.execute(userId, quoteId, input);
    return MePresenter.toQuoteDataResponse(quote);
  }
}
