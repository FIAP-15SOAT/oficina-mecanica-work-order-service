import { IChangeOwnPasswordUseCase } from '@application/ports/input/me/change-own-password.use-case.interface';
import { IFindUserByIdUseCase } from '@application/ports/input/user/find-user-by-id.use-case.interface';
import { IFindAllMyWorkOrdersUseCase } from '@application/ports/input/me/find-all-my-work-orders.use-case.interface';
import { IFindMyWorkOrderByIdUseCase } from '@application/ports/input/me/find-my-work-order-by-id.use-case.interface';
import { IFindMyWorkOrdersQuotesUseCase } from '@application/ports/input/me/find-my-work-orders-quotes.use-case.interface';
import { IFindMyQuoteByIdUseCase } from '@application/ports/input/me/find-my-quote-by-id.use-case.interface';
import { IDecideMyQuoteUseCase } from '@application/ports/input/me/decide-my-quote.use-case.interface';

import { ChangeOwnPasswordDto } from '@application/ports/input/me/dto/change-own-password.dto';
import { QuoteDecisionDto } from '@application/ports/input/me/dto/quote-decision.dto';
import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { PaginationInput } from '@domain/interfaces/common/pagination.interface';

import { MePresenter } from './me.presenter';
import {
  MeDataResponse,
  MyWorkOrderDataResponse,
  MyWorkOrderPaginatedResponse,
  MyQuoteDataResponse,
  MyQuoteListResponse,
} from './responses/me.response';

export class MeController {
  constructor(
    private readonly changeOwnPasswordUseCase: IChangeOwnPasswordUseCase,
    private readonly findUserByIdUseCase: IFindUserByIdUseCase,
    private readonly findAllMyWorkOrdersUseCase: IFindAllMyWorkOrdersUseCase,
    private readonly findMyWorkOrderByIdUseCase: IFindMyWorkOrderByIdUseCase,
    private readonly findMyWorkOrdersQuotesUseCase: IFindMyWorkOrdersQuotesUseCase,
    private readonly findMyQuoteByIdUseCase: IFindMyQuoteByIdUseCase,
    private readonly decideMyQuoteUseCase: IDecideMyQuoteUseCase,
  ) {}

  async changePassword(userId: string, input: ChangeOwnPasswordDto): Promise<void> {
    await this.changeOwnPasswordUseCase.execute(userId, input);
  }

  async getMe(principal: AuthenticatedPrincipal): Promise<MeDataResponse> {
    const result = await this.findUserByIdUseCase.execute(principal.sub);
    return MePresenter.toMeDataResponse(result);
  }

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
