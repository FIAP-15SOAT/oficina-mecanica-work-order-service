import { randomUUID } from 'node:crypto';

import { MePresenter } from '@interface-adapters/me/me.presenter';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { UserRole } from '@domain/enums/user-role.enum';
import { FindUserByIdOutput } from '@application/ports/input/user/find-user-by-id.use-case.interface';

import { createMockWorkOrder } from '../../../helpers/work-order-mock.factory';
import { createMockVehicle } from '../../../helpers/vehicle-mock.factory';
import { createMockCustomer } from '../../../helpers/customer-mock.factory';
import {
  createMockQuote,
  createMockQuoteService,
  createMockQuotePartSupply,
} from '../../../helpers/quote-mock.factory';
import { createMockService } from '../../../helpers/service-mock.factory';
import { createMockPartSupply } from '../../../helpers/part-supply-mock.factory';

describe('MePresenter', () => {
  describe('toMeDataResponse', () => {
    it('should not list the principal own INDIVIDUAL customer', () => {
      const ownIndividual = createMockCustomer({ type: CustomerType.INDIVIDUAL });
      const user: FindUserByIdOutput = {
        id: randomUUID(),
        name: 'João da Silva',
        email: 'joao@example.com',
        role: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        customers: [ownIndividual],
      };

      expect(MePresenter.toMeDataResponse(user)).toEqual({
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          customers: [],
        },
      });
    });

    it('should list only the COMPANY customers and omit isActive/createdAt/updatedAt', () => {
      const ownIndividual = createMockCustomer({ type: CustomerType.INDIVIDUAL });
      const company = createMockCustomer({
        type: CustomerType.COMPANY,
        name: 'Oficina Parceira LTDA',
      });
      const user: FindUserByIdOutput = {
        id: randomUUID(),
        name: 'Ana',
        email: 'ana@example.com',
        role: UserRole.ATTENDANT,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        customers: [ownIndividual, company],
      };

      const response = MePresenter.toMeDataResponse(user);

      expect(response).toEqual({
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          customers: [{ id: company.id, name: company.name, type: CustomerType.COMPANY }],
        },
      });
      expect(response.data).not.toHaveProperty('isActive');
      expect(response.data).not.toHaveProperty('createdAt');
      expect(response.data).not.toHaveProperty('updatedAt');
    });
  });

  describe('toWorkOrderResponse', () => {
    it('should map a work order with a vehicle', () => {
      const vehicle = createMockVehicle({ brand: 'Toyota', model: 'Corolla' });
      const workOrder = createMockWorkOrder({
        vehicle,
        problemDescription: 'Barulho no motor',
        customer: createMockCustomer(),
      });

      const response = MePresenter.toWorkOrderResponse(workOrder);

      expect(response.id).toBe(workOrder.id);
      expect(response.problemDescription).toBe('Barulho no motor');
      expect(response.vehicle).toEqual({
        id: vehicle.id,
        plate: vehicle.plate.value,
        brand: 'Toyota',
        model: 'Corolla',
      });
    });

    it('should map a work order without a vehicle as null', () => {
      const workOrder = createMockWorkOrder({ vehicle: undefined, customer: createMockCustomer() });

      const response = MePresenter.toWorkOrderResponse(workOrder);

      expect(response.vehicle).toBeNull();
    });

    it('should map the customer owning the work order', () => {
      const customer = createMockCustomer({
        type: CustomerType.COMPANY,
        name: 'Oficina Parceira LTDA',
      });
      const workOrder = createMockWorkOrder({ vehicle: undefined, customer });

      const response = MePresenter.toWorkOrderResponse(workOrder);

      expect(response.customer).toEqual({
        id: customer.id,
        name: customer.name,
        type: CustomerType.COMPANY,
      });
    });

    it('should throw when the customer was not loaded', () => {
      const workOrder = createMockWorkOrder({ vehicle: undefined });

      expect(() => MePresenter.toWorkOrderResponse(workOrder)).toThrow();
    });
  });

  describe('toWorkOrderDataResponse', () => {
    it('should wrap the work order response in a data property', () => {
      const workOrder = createMockWorkOrder({ vehicle: undefined, customer: createMockCustomer() });

      expect(MePresenter.toWorkOrderDataResponse(workOrder)).toEqual({
        data: MePresenter.toWorkOrderResponse(workOrder),
      });
    });
  });

  describe('toWorkOrderPaginatedResponse', () => {
    it('should map items and build pagination metadata', () => {
      const workOrders = [
        createMockWorkOrder({ vehicle: undefined, customer: createMockCustomer() }),
      ];

      const response = MePresenter.toWorkOrderPaginatedResponse(
        { items: workOrders, total: 1 },
        { page: 1, limit: 10 },
      );

      expect(response.data).toEqual([MePresenter.toWorkOrderResponse(workOrders[0])]);
      expect(response.pagination).toEqual({
        totalRecords: 1,
        totalPages: 1,
        page: 1,
        limit: 10,
      });
    });
  });

  describe('toQuoteResponse', () => {
    it('should map services and parts supplies with their names', () => {
      const service = createMockService({ name: 'Troca de óleo' });
      const partSupply = createMockPartSupply({ name: 'Filtro de óleo' });
      const quoteService = createMockQuoteService({
        serviceId: service.id,
        quantity: 2,
        unitPrice: 50,
        totalPrice: 100,
      });
      quoteService.service = service;
      const quotePartSupply = createMockQuotePartSupply({
        partSupplyId: partSupply.id,
        quantity: 1,
        unitPrice: 30,
        totalPrice: 30,
      });
      quotePartSupply.partSupply = partSupply;

      const quote = createMockQuote({
        status: QuoteStatus.SENT,
        services: [quoteService],
        partsSupplies: [quotePartSupply],
      });

      const response = MePresenter.toQuoteResponse(quote);

      expect(response.id).toBe(quote.id);
      expect(response.status).toBe(QuoteStatus.SENT);
      expect(response.services).toEqual([
        { id: service.id, name: 'Troca de óleo', quantity: 2, unitPrice: 50, totalPrice: 100 },
      ]);
      expect(response.partsSupplies).toEqual([
        { id: partSupply.id, name: 'Filtro de óleo', quantity: 1, unitPrice: 30, totalPrice: 30 },
      ]);
    });

    /**
     * `toQuoteResponse` is only called with a Quote loaded through
     * `findByIdWithDetails` — the `!` assertion must blow up, not stay silent,
     * if that premise is broken (see docs/testing.md).
     */
    it('should throw when an item reference was not loaded', () => {
      const quoteService = createMockQuoteService();
      const quote = createMockQuote({ services: [quoteService], partsSupplies: [] });

      expect(() => MePresenter.toQuoteResponse(quote)).toThrow();
    });
  });

  describe('toQuoteSummaryResponse', () => {
    it('should map the quote without its items', () => {
      const quote = createMockQuote({ status: QuoteStatus.SENT });

      const response = MePresenter.toQuoteSummaryResponse(quote);

      expect(response).toEqual({
        id: quote.id,
        status: QuoteStatus.SENT,
        servicesAmount: quote.servicesAmount,
        partsAmount: quote.partsAmount,
        totalAmount: quote.totalAmount,
        notes: quote.notes,
        sentAt: quote.sentAt,
        approvedAt: quote.approvedAt,
        rejectedAt: quote.rejectedAt,
      });
      expect(response).not.toHaveProperty('services');
      expect(response).not.toHaveProperty('partsSupplies');
    });
  });

  describe('toQuoteDataResponse', () => {
    it('should wrap the quote response in a data property', () => {
      const service = createMockService();
      const quoteService = createMockQuoteService({ serviceId: service.id });
      quoteService.service = service;
      const quote = createMockQuote({ services: [quoteService], partsSupplies: [] });

      expect(MePresenter.toQuoteDataResponse(quote)).toEqual({
        data: MePresenter.toQuoteResponse(quote),
      });
    });
  });

  describe('toQuoteListResponse', () => {
    it('should map every quote to its summary (no items) and wrap them in a data property', () => {
      const quotes = [createMockQuote(), createMockQuote()];

      expect(MePresenter.toQuoteListResponse(quotes)).toEqual({
        data: quotes.map((quote) => MePresenter.toQuoteSummaryResponse(quote)),
      });
    });
  });
});
