import { MePresenter } from '@interface-adapters/me/me.presenter';
import { CustomerType } from '@domain/enums/customer-type.enum';

import { createMockWorkOrder } from '../../../helpers/work-order-mock.factory';
import { createMockVehicle } from '../../../helpers/vehicle-mock.factory';
import { createMockCustomer } from '../../../helpers/customer-mock.factory';
import {
  readInternalQuoteFixture,
  readInternalWorkOrderQuotesFixture,
} from '../../../helpers/billing-quotes-gateway-mock.factory';
import { readInternalWorkOrderPaymentsFixture } from '../../../helpers/billing-payments-gateway-mock.factory';

describe('MePresenter', () => {
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

  describe('toQuoteDataResponse', () => {
    it('should present the Billing quote with its items as the customer quote', () => {
      const quote = readInternalQuoteFixture().data;
      const [service] = quote.services;
      const [partSupply] = quote.partsSupplies;

      const response = MePresenter.toQuoteDataResponse(quote);

      expect(response).toEqual({
        data: {
          id: quote.id,
          status: quote.status,
          servicesAmount: quote.servicesAmount,
          partsAmount: quote.partsAmount,
          totalAmount: quote.totalAmount,
          notes: quote.notes,
          sentAt: quote.sentAt,
          approvedAt: quote.approvedAt,
          rejectedAt: quote.rejectedAt,
          services: [
            {
              id: service.id,
              name: service.name,
              quantity: service.quantity,
              unitPrice: service.unitPrice,
              totalPrice: service.totalPrice,
            },
          ],
          partsSupplies: [
            {
              id: partSupply.id,
              name: partSupply.name,
              quantity: partSupply.quantity,
              unitPrice: partSupply.unitPrice,
              totalPrice: partSupply.totalPrice,
            },
          ],
        },
      });
    });
  });

  describe('toQuoteListResponse', () => {
    it('should present the Billing quote summaries without items', () => {
      const [quote] = readInternalWorkOrderQuotesFixture().data;

      const response = MePresenter.toQuoteListResponse([quote]);

      expect(response).toEqual({
        data: [
          {
            id: quote.id,
            status: quote.status,
            servicesAmount: quote.servicesAmount,
            partsAmount: quote.partsAmount,
            totalAmount: quote.totalAmount,
            notes: quote.notes,
            sentAt: quote.sentAt,
            approvedAt: quote.approvedAt,
            rejectedAt: quote.rejectedAt,
          },
        ],
      });
    });
  });

  describe('toPaymentListResponse', () => {
    it('should present the Billing payments without checkoutId and workOrderId', () => {
      const [payment] = readInternalWorkOrderPaymentsFixture().data;

      const response = MePresenter.toPaymentListResponse([payment]);

      expect(response).toEqual({
        data: [
          {
            id: payment.id,
            amount: payment.amount,
            status: payment.status,
            checkoutUrl: payment.checkoutUrl,
            expiresAt: payment.expiresAt,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
          },
        ],
      });
    });
  });
});
