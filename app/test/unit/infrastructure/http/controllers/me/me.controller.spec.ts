import { randomUUID } from 'node:crypto';

import { MeController } from '@infrastructure/http/controllers/me/me.controller';
import { MeController as MeCleanController } from '@interface-adapters/me/me.controller';
import { MePresenter } from '@interface-adapters/me/me.presenter';

import { CustomerType } from '@domain/enums/customer-type.enum';
import { QuoteDecisionAction } from '@domain/enums/quote-decision-action.enum';
import { AuthFlow } from '@domain/enums/auth-flow.enum';

import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { ChangeOwnPasswordRequestDto } from '@infrastructure/http/controllers/me/dto/requests/change-own-password-request.dto';
import { DecideMyQuoteRequestDto } from '@infrastructure/http/controllers/me/dto/requests/decide-my-quote-request.dto';
import { FindMyWorkOrdersQueryDto } from '@infrastructure/http/controllers/me/dto/requests/find-my-work-orders-query.dto';

import { createMockCustomer } from '../../../../../helpers/customer-mock.factory';
import { createMockQuote } from '../../../../../helpers/quote-mock.factory';
import { createMockWorkOrder } from '../../../../../helpers/work-order-mock.factory';

describe('MeController', () => {
  let httpController: MeController;
  let cleanController: MeCleanController;

  const principal: AuthenticatedPrincipal = {
    sub: randomUUID(),
    authFlow: AuthFlow.CUSTOMER,
    email: 'joao@example.com',
  };
  const workOrderStub = createMockWorkOrder({
    vehicle: undefined,
    customer: createMockCustomer({ type: CustomerType.COMPANY }),
  });
  const quoteStub = createMockQuote({ services: [], partsSupplies: [] });

  beforeEach(() => {
    cleanController = new MeCleanController(
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
    );
    httpController = new MeController(cleanController);
  });

  describe('getMe', () => {
    it('should delegate the principal to the clean controller and return its result', async () => {
      const response = MePresenter.toMeDataResponse({
        id: principal.sub,
        name: 'João da Silva',
        email: principal.email,
        role: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        customers: [],
      });
      jest.spyOn(cleanController, 'getMe').mockResolvedValue(response);

      const result = await httpController.getMe(principal);

      expect(result).toBe(response);
      expect(cleanController.getMe).toHaveBeenCalledWith(principal);
    });
  });

  describe('changePassword', () => {
    it('should delegate the principal subject and the body to the clean controller', async () => {
      const request: ChangeOwnPasswordRequestDto = {
        currentPassword: 'Tech@2026',
        newPassword: 'Tech@2027',
      };
      jest.spyOn(cleanController, 'changePassword').mockResolvedValue(undefined);

      await httpController.changePassword(request, principal);

      expect(cleanController.changePassword).toHaveBeenCalledWith(principal.sub, request);
    });
  });

  describe('listWorkOrders', () => {
    it('should pass the query pagination straight through', async () => {
      const query: FindMyWorkOrdersQueryDto = {
        page: 3,
        limit: 25,
        customerId: workOrderStub.customerId,
      };
      const response = MePresenter.toWorkOrderPaginatedResponse(
        { items: [workOrderStub], total: 1 },
        { page: 3, limit: 25 },
      );
      jest.spyOn(cleanController, 'listWorkOrders').mockResolvedValue(response);

      const result = await httpController.listWorkOrders(query, principal);

      expect(result).toBe(response);
      expect(cleanController.listWorkOrders).toHaveBeenCalledWith(
        principal.sub,
        { page: 3, limit: 25 },
        query.customerId,
      );
    });

    it('should apply the first-page defaults when the query omits pagination', async () => {
      const response = MePresenter.toWorkOrderPaginatedResponse(
        { items: [workOrderStub], total: 1 },
        { page: 1, limit: 10 },
      );
      jest.spyOn(cleanController, 'listWorkOrders').mockResolvedValue(response);

      const result = await httpController.listWorkOrders({}, principal);

      expect(result).toBe(response);
      expect(cleanController.listWorkOrders).toHaveBeenCalledWith(
        principal.sub,
        { page: 1, limit: 10 },
        undefined,
      );
    });
  });

  describe('getWorkOrder', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const response = MePresenter.toWorkOrderDataResponse(workOrderStub);
      jest.spyOn(cleanController, 'getWorkOrder').mockResolvedValue(response);

      const result = await httpController.getWorkOrder(workOrderStub.id, principal);

      expect(result).toBe(response);
      expect(cleanController.getWorkOrder).toHaveBeenCalledWith(principal.sub, workOrderStub.id);
    });
  });

  describe('listWorkOrderQuotes', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const response = MePresenter.toQuoteListResponse([quoteStub]);
      jest.spyOn(cleanController, 'listWorkOrderQuotes').mockResolvedValue(response);

      const result = await httpController.listWorkOrderQuotes(workOrderStub.id, principal);

      expect(result).toBe(response);
      expect(cleanController.listWorkOrderQuotes).toHaveBeenCalledWith(
        principal.sub,
        workOrderStub.id,
      );
    });
  });

  describe('getQuote', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const response = MePresenter.toQuoteDataResponse(quoteStub);
      jest.spyOn(cleanController, 'getQuote').mockResolvedValue(response);

      const result = await httpController.getQuote(quoteStub.id, principal);

      expect(result).toBe(response);
      expect(cleanController.getQuote).toHaveBeenCalledWith(principal.sub, quoteStub.id);
    });
  });

  describe('decideQuote', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const request: DecideMyQuoteRequestDto = {
        action: QuoteDecisionAction.REJECT,
        reason: 'Valor acima do previsto',
      };
      const response = MePresenter.toQuoteDataResponse(quoteStub);
      jest.spyOn(cleanController, 'decideQuote').mockResolvedValue(response);

      const result = await httpController.decideQuote(quoteStub.id, request, principal);

      expect(result).toBe(response);
      expect(cleanController.decideQuote).toHaveBeenCalledWith(
        principal.sub,
        quoteStub.id,
        request,
      );
    });
  });
});
