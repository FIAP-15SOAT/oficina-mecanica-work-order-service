import { randomUUID } from 'node:crypto';

import { MeController } from '@interface-adapters/me/me.controller';
import { MePresenter } from '@interface-adapters/me/me.presenter';

import { QuoteDecisionAction } from '@domain/enums/quote-decision-action.enum';

import { createMockWorkOrder } from '../../../helpers/work-order-mock.factory';
import {
  readInternalQuoteFixture,
  readInternalWorkOrderQuotesFixture,
} from '../../../helpers/billing-quotes-gateway-mock.factory';
import { readInternalWorkOrderPaymentsFixture } from '../../../helpers/billing-payments-gateway-mock.factory';
import { createMockCustomer } from '../../../helpers/customer-mock.factory';

describe('MeController', () => {
  let controller: MeController;
  let findAllMyWorkOrdersUseCase: { execute: jest.Mock };
  let findMyWorkOrderByIdUseCase: { execute: jest.Mock };
  let findMyWorkOrdersQuotesUseCase: { execute: jest.Mock };
  let findMyQuoteByIdUseCase: { execute: jest.Mock };
  let decideQuoteUseCase: { execute: jest.Mock };
  let findMyWorkOrderPaymentsUseCase: { execute: jest.Mock };

  beforeEach(() => {
    findAllMyWorkOrdersUseCase = { execute: jest.fn() };
    findMyWorkOrderByIdUseCase = { execute: jest.fn() };
    findMyWorkOrdersQuotesUseCase = { execute: jest.fn() };
    findMyQuoteByIdUseCase = { execute: jest.fn() };
    decideQuoteUseCase = { execute: jest.fn() };
    findMyWorkOrderPaymentsUseCase = { execute: jest.fn() };

    controller = new MeController(
      findAllMyWorkOrdersUseCase,
      findMyWorkOrderByIdUseCase,
      findMyWorkOrdersQuotesUseCase,
      findMyQuoteByIdUseCase,
      decideQuoteUseCase,
      findMyWorkOrderPaymentsUseCase,
    );
  });

  describe('listWorkOrders', () => {
    it('should forward to the use case and build a paginated response', async () => {
      const userId = randomUUID();
      const pagination = { page: 1, limit: 10 };
      const customerId = randomUUID();
      const workOrders = [
        createMockWorkOrder({ vehicle: undefined, customer: createMockCustomer() }),
      ];

      findAllMyWorkOrdersUseCase.execute.mockResolvedValue({ items: workOrders, total: 1 });

      const response = await controller.listWorkOrders(userId, pagination, customerId);

      expect(findAllMyWorkOrdersUseCase.execute).toHaveBeenCalledWith(
        userId,
        pagination,
        customerId,
      );
      expect(response).toEqual(
        MePresenter.toWorkOrderPaginatedResponse({ items: workOrders, total: 1 }, pagination),
      );
    });
  });

  describe('getWorkOrder', () => {
    it('should forward to the use case and wrap the result in data', async () => {
      const userId = randomUUID();
      const workOrder = createMockWorkOrder({ vehicle: undefined, customer: createMockCustomer() });

      findMyWorkOrderByIdUseCase.execute.mockResolvedValue(workOrder);

      const response = await controller.getWorkOrder(userId, workOrder.id);

      expect(findMyWorkOrderByIdUseCase.execute).toHaveBeenCalledWith(userId, workOrder.id);
      expect(response).toEqual(MePresenter.toWorkOrderDataResponse(workOrder));
    });
  });

  describe('listWorkOrderQuotes', () => {
    it('should forward to the use case and wrap the result in data', async () => {
      const userId = randomUUID();
      const workOrderId = randomUUID();
      const quotes = readInternalWorkOrderQuotesFixture().data;

      findMyWorkOrdersQuotesUseCase.execute.mockResolvedValue(quotes);

      const response = await controller.listWorkOrderQuotes(userId, workOrderId);

      expect(findMyWorkOrdersQuotesUseCase.execute).toHaveBeenCalledWith(userId, workOrderId);
      expect(response).toEqual(MePresenter.toQuoteListResponse(quotes));
    });
  });

  describe('listWorkOrderPayments', () => {
    it('should forward to the use case and wrap the result in data', async () => {
      const userId = randomUUID();
      const workOrderId = randomUUID();
      const payments = readInternalWorkOrderPaymentsFixture().data;

      findMyWorkOrderPaymentsUseCase.execute.mockResolvedValue(payments);

      const response = await controller.listWorkOrderPayments(userId, workOrderId);

      expect(findMyWorkOrderPaymentsUseCase.execute).toHaveBeenCalledWith(userId, workOrderId);
      expect(response).toEqual(MePresenter.toPaymentListResponse(payments));
    });
  });

  describe('getQuote', () => {
    it('should forward to the use case and present the Billing quote', async () => {
      const userId = randomUUID();
      const quote = readInternalQuoteFixture().data;

      findMyQuoteByIdUseCase.execute.mockResolvedValue(quote);

      const response = await controller.getQuote(userId, quote.id);

      expect(findMyQuoteByIdUseCase.execute).toHaveBeenCalledWith(userId, quote.id);
      expect(response).toEqual(MePresenter.toQuoteDataResponse(quote));
    });
  });

  describe('decideQuote', () => {
    it('should forward to the use case and present the decided quote', async () => {
      const userId = randomUUID();
      const decided = readInternalQuoteFixture().data;
      const input = { action: QuoteDecisionAction.APPROVE };

      decideQuoteUseCase.execute.mockResolvedValue(decided);

      const response = await controller.decideQuote(userId, decided.id, input);

      expect(decideQuoteUseCase.execute).toHaveBeenCalledWith(userId, decided.id, input);
      expect(findMyQuoteByIdUseCase.execute).not.toHaveBeenCalled();
      expect(response).toEqual(MePresenter.toQuoteDataResponse(decided));
    });
  });
});
