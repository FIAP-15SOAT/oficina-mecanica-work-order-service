import { randomUUID } from 'node:crypto';

import { MeController } from '@interface-adapters/me/me.controller';
import { MePresenter } from '@interface-adapters/me/me.presenter';

import { UserRole } from '@domain/enums/user-role.enum';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { QuoteDecisionAction } from '@domain/enums/quote-decision-action.enum';
import { AuthFlow } from '@domain/enums/auth-flow.enum';
import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';

import { createMockWorkOrder } from '../../../helpers/work-order-mock.factory';
import { createMockQuote } from '../../../helpers/quote-mock.factory';
import { createMockCustomer } from '../../../helpers/customer-mock.factory';

describe('MeController', () => {
  let controller: MeController;
  let changePasswordUseCase: { execute: jest.Mock };
  let findUserByIdUseCase: { execute: jest.Mock };
  let findAllMyWorkOrdersUseCase: { execute: jest.Mock };
  let findMyWorkOrderByIdUseCase: { execute: jest.Mock };
  let findMyWorkOrdersQuotesUseCase: { execute: jest.Mock };
  let findMyQuoteByIdUseCase: { execute: jest.Mock };
  let decideQuoteUseCase: { execute: jest.Mock };

  beforeEach(() => {
    changePasswordUseCase = { execute: jest.fn() };
    findUserByIdUseCase = { execute: jest.fn() };
    findAllMyWorkOrdersUseCase = { execute: jest.fn() };
    findMyWorkOrderByIdUseCase = { execute: jest.fn() };
    findMyWorkOrdersQuotesUseCase = { execute: jest.fn() };
    findMyQuoteByIdUseCase = { execute: jest.fn() };
    decideQuoteUseCase = { execute: jest.fn() };

    controller = new MeController(
      changePasswordUseCase,
      findUserByIdUseCase,
      findAllMyWorkOrdersUseCase,
      findMyWorkOrderByIdUseCase,
      findMyWorkOrdersQuotesUseCase,
      findMyQuoteByIdUseCase,
      decideQuoteUseCase,
    );
  });

  describe('changePassword', () => {
    it('should forward to the use case', async () => {
      const userId = randomUUID();
      const input = { currentPassword: 'old-pass', newPassword: 'new-pass' };

      changePasswordUseCase.execute.mockResolvedValue(undefined);

      await controller.changePassword(userId, input);

      expect(changePasswordUseCase.execute).toHaveBeenCalledWith(userId, input);
    });
  });

  describe('getMe', () => {
    it('should look up the principal by id and wrap the presenter result in data', async () => {
      const principal: AuthenticatedPrincipal = {
        sub: randomUUID(),
        authFlow: AuthFlow.INTERNAL,
        email: 'joao@example.com',
        role: UserRole.ATTENDANT,
      };
      const result = {
        id: principal.sub,
        name: 'João',
        email: principal.email,
        role: principal.role,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        customers: [createMockCustomer({ type: CustomerType.INDIVIDUAL })],
      };

      findUserByIdUseCase.execute.mockResolvedValue(result);

      const response = await controller.getMe(principal);

      expect(findUserByIdUseCase.execute).toHaveBeenCalledWith(principal.sub);
      expect(response).toEqual(MePresenter.toMeDataResponse(result));
    });
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
      const quotes = [createMockQuote()];

      findMyWorkOrdersQuotesUseCase.execute.mockResolvedValue(quotes);

      const response = await controller.listWorkOrderQuotes(userId, workOrderId);

      expect(findMyWorkOrdersQuotesUseCase.execute).toHaveBeenCalledWith(userId, workOrderId);
      expect(response).toEqual(MePresenter.toQuoteListResponse(quotes));
    });
  });

  describe('getQuote', () => {
    it('should forward to the use case and wrap the result in data', async () => {
      const userId = randomUUID();
      const quote = createMockQuote();

      findMyQuoteByIdUseCase.execute.mockResolvedValue(quote);

      const response = await controller.getQuote(userId, quote.id);

      expect(findMyQuoteByIdUseCase.execute).toHaveBeenCalledWith(userId, quote.id);
      expect(response).toEqual(MePresenter.toQuoteDataResponse(quote));
    });
  });

  describe('decideQuote', () => {
    it('should forward to the use case and wrap the result in data', async () => {
      const userId = randomUUID();
      const quote = createMockQuote();
      const input = { action: QuoteDecisionAction.APPROVE };

      decideQuoteUseCase.execute.mockResolvedValue(quote);

      const response = await controller.decideQuote(userId, quote.id, input);

      expect(decideQuoteUseCase.execute).toHaveBeenCalledWith(userId, quote.id, input);
      expect(response).toEqual(MePresenter.toQuoteDataResponse(quote));
    });
  });
});
