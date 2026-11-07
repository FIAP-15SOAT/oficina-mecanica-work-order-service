import { randomUUID } from 'node:crypto';

import { Quote } from '@domain/entities/quote.entity';
import { QuoteStatus } from '@domain/enums/quote-status.enum';

import { QuotePresenter } from '@interface-adapters/quote/quote.presenter';

import { createMockWorkOrder } from '../../../helpers/work-order-mock.factory';
import { createMockCustomer } from '../../../helpers/customer-mock.factory';
import { createMockVehicle } from '../../../helpers/vehicle-mock.factory';
import {
  createMockQuotePartSupply,
  createMockQuoteService,
} from '../../../helpers/quote-mock.factory';
import {
  createMockInventoryPartSupplyGatewayResponse,
  createMockInventoryServiceGatewayResponse,
} from '../../../helpers/inventory-catalog-gateway-mock.factory';

describe('QuotePresenter', () => {
  function buildQuoteWithWorkOrder(extra: object = {}) {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const workOrder = createMockWorkOrder({ customer, vehicle });

    const now = new Date();

    const quote = Quote.reconstitute({
      id: randomUUID(),
      workOrderId: workOrder.id,
      servicesAmount: 150,
      partsAmount: 50,
      totalAmount: 200,
      version: 0,
      status: QuoteStatus.PENDING,
      notes: 'test notes',
      sentAt: now,
      approvedAt: null,
      rejectedAt: null,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    quote.workOrder = workOrder;
    return quote;
  }

  describe('toResponse', () => {
    it('should format a quote with workOrder correctly', () => {
      const quote = buildQuoteWithWorkOrder();
      const response = QuotePresenter.toResponse(quote);

      expect(response.id).toBe(quote.id);
      expect(response.totalAmount).toBe(200);
      expect(response.workOrder).toBeDefined();
      expect(response.workOrder.id).toBe(quote.workOrder!.id);
      expect('workOrderId' in response).toBe(false);
      expect(response.workOrder.services).toBeUndefined();
      expect(response.workOrder.partSupplies).toBeUndefined();
    });
  });

  describe('toDataResponse', () => {
    it('should wrap response in data property', () => {
      const quote = buildQuoteWithWorkOrder();

      const response = QuotePresenter.toDataResponse(quote);
      expect(response.data.id).toBe(quote.id);
      expect(response.data.workOrder).toBeDefined();
    });
  });

  describe('toWithItemsResponse', () => {
    it('should present the item display fields read from the catalog', () => {
      const service = createMockInventoryServiceGatewayResponse();
      const partSupply = createMockInventoryPartSupplyGatewayResponse();

      const quote = buildQuoteWithWorkOrder({
        services: [createMockQuoteService({ serviceId: service.id })],
        partsSupplies: [createMockQuotePartSupply({ partSupplyId: partSupply.id })],
      });

      const response = QuotePresenter.toWithItemsResponse(quote, {
        services: [service],
        partsSupplies: [partSupply],
      });

      expect(response.data.services[0]).toMatchObject({
        id: service.id,
        name: service.name,
        description: service.description,
      });

      expect(response.data.partsSupplies[0]).toMatchObject({
        id: partSupply.id,
        name: partSupply.name,
        description: partSupply.description,
        sku: partSupply.sku,
        partNumber: partSupply.partNumber,
        category: partSupply.category,
        unit: partSupply.unit,
      });
    });

    it('should present null display fields for an item the catalog no longer has', () => {
      const serviceItem = createMockQuoteService({ quantity: 2, unitPrice: 100, totalPrice: 200 });
      const partSupplyItem = createMockQuotePartSupply({
        quantity: 1,
        unitPrice: 45,
        totalPrice: 45,
      });

      const quote = buildQuoteWithWorkOrder({
        services: [serviceItem],
        partsSupplies: [partSupplyItem],
      });

      const response = QuotePresenter.toWithItemsResponse(quote, {
        services: [],
        partsSupplies: [],
      });

      expect(response.data.services[0]).toMatchObject({
        id: serviceItem.serviceId,
        name: null,
        description: null,
        quantity: 2,
        unitPrice: 100,
        totalPrice: 200,
      });

      expect(response.data.partsSupplies[0]).toMatchObject({
        id: partSupplyItem.partSupplyId,
        name: null,
        description: null,
        sku: null,
        partNumber: null,
        category: null,
        unit: null,
        quantity: 1,
        unitPrice: 45,
        totalPrice: 45,
      });
    });
  });

  describe('toPaginatedResponse', () => {
    it('should format paginated result correctly', () => {
      const quote = buildQuoteWithWorkOrder();

      const paginatedResult = {
        items: [quote],
        pagination: {
          totalRecords: 1,
          totalPages: 1,
          page: 1,
          limit: 10,
        },
      };

      const response = QuotePresenter.toPaginatedResponse(paginatedResult);

      expect(response.data).toHaveLength(1);
      expect(response.data[0].id).toBe(quote.id);
      expect(response.data[0].workOrder).toBeDefined();
      expect(response.pagination).toEqual(paginatedResult.pagination);
    });
  });

  describe('toListResponse', () => {
    it('should format list result correctly', () => {
      const quote = buildQuoteWithWorkOrder();

      const response = QuotePresenter.toListResponse([quote]);

      expect(response.data).toHaveLength(1);
      expect(response.data[0].id).toBe(quote.id);
      expect(response.data[0].workOrder).toBeDefined();
    });
  });
});
