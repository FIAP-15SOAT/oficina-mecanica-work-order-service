import { randomUUID } from 'node:crypto';

import { WorkOrderController } from '@infrastructure/http/controllers/work-order/work-order.controller';
import { WorkOrderController as WorkOrderCleanController } from '@interface-adapters/work-order/work-order.controller';

import { WorkOrderPresenter } from '@interface-adapters/work-order/work-order.presenter';
import { QuotePresenter } from '@interface-adapters/quote/quote.presenter';

import { CreateWorkOrderRequestDto } from '@infrastructure/http/controllers/work-order/dto/requests/create-work-order-request.dto';
import { UpdateWorkOrderRequestDto } from '@infrastructure/http/controllers/work-order/dto/requests/update-work-order-request.dto';
import { UpdateWorkOrderStatusRequestDto } from '@infrastructure/http/controllers/work-order/dto/requests/update-work-order-status-request.dto';
import { UpdateWorkOrderServiceStatusRequestDto } from '@infrastructure/http/controllers/work-order/dto/requests/update-work-order-service-status-request.dto';
import { FindAllWorkOrdersPaginatedQueryDto } from '@infrastructure/http/controllers/work-order/dto/requests/filter-work-orders.dto';

import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { UserRole } from '@domain/enums/user-role.enum';
import { AuthFlow } from '@domain/enums/auth-flow.enum';

import { createMockCustomer } from '../../../../../helpers/customer-mock.factory';
import { createMockVehicle } from '../../../../../helpers/vehicle-mock.factory';
import { createMockWorkOrder } from '../../../../../helpers/work-order-mock.factory';
import { createMockWorkOrderService } from '../../../../../helpers/work-order-service-mock.factory';
import { createMockService } from '../../../../../helpers/service-mock.factory';
import { createMockQuote } from '../../../../../helpers/quote-mock.factory';

describe('WorkOrderController', () => {
  let httpController: WorkOrderController;
  let cleanController: WorkOrderCleanController;

  const customer = createMockCustomer();
  const vehicle = createMockVehicle({ customerId: customer.id });
  const currentUser: AuthenticatedPrincipal = {
    sub: randomUUID(),
    authFlow: AuthFlow.INTERNAL,
    email: 'mecanico@oficina.com',
    role: UserRole.MECHANIC,
  };

  const createRequestStub: CreateWorkOrderRequestDto = {
    customerId: customer.id,
    vehicleId: vehicle.id,
  };

  beforeEach(() => {
    cleanController = new WorkOrderCleanController(
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
    );
    httpController = new WorkOrderController(cleanController);
  });

  describe('create', () => {
    it('should delegate to the clean controller with the current user id', async () => {
      const response = WorkOrderPresenter.toDataResponse(
        createMockWorkOrder({ customer, vehicle }),
      );

      jest.spyOn(cleanController, 'create').mockResolvedValue(response);

      const result = await httpController.create(createRequestStub, currentUser);

      expect(result).toBe(response);
      expect(cleanController.create).toHaveBeenCalledWith(createRequestStub, currentUser.sub);
    });
  });

  describe('findAll', () => {
    it('should pass the query straight to the clean controller and return its result', async () => {
      const query: FindAllWorkOrdersPaginatedQueryDto = { page: 1, limit: 10 };

      const response = WorkOrderPresenter.toPaginatedResponse({
        items: [createMockWorkOrder({ customer, vehicle })],
        pagination: { totalRecords: 1, totalPages: 1, page: 1, limit: 10 },
      });

      jest.spyOn(cleanController, 'findAll').mockResolvedValue(response);

      const result = await httpController.findAll(query);

      expect(result).toBe(response);
      expect(cleanController.findAll).toHaveBeenCalledWith(query);
    });
  });

  describe('findOne', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const workOrder = createMockWorkOrder({ customer, vehicle });
      const response = WorkOrderPresenter.toDataResponse(workOrder);

      jest.spyOn(cleanController, 'findOne').mockResolvedValue(response);

      const result = await httpController.findOne(workOrder.id);

      expect(result).toBe(response);
      expect(cleanController.findOne).toHaveBeenCalledWith(workOrder.id);
    });
  });

  describe('update', () => {
    it('should delegate to the clean controller with the current user id', async () => {
      const id = randomUUID();

      const updateRequestStub: UpdateWorkOrderRequestDto = { problemDescription: 'Barulho' };

      const response = WorkOrderPresenter.toDataResponse(
        createMockWorkOrder({ customer, vehicle }),
      );

      jest.spyOn(cleanController, 'update').mockResolvedValue(response);

      const result = await httpController.update(id, updateRequestStub, currentUser);

      expect(result).toBe(response);
      expect(cleanController.update).toHaveBeenCalledWith(id, updateRequestStub, currentUser.sub);
    });
  });

  describe('updateStatus', () => {
    it('should delegate to the clean controller with the current user id', async () => {
      const id = randomUUID();

      const statusRequestStub: UpdateWorkOrderStatusRequestDto = {
        status: WorkOrderStatus.IN_DIAGNOSIS,
      };
      const response = WorkOrderPresenter.toDataResponse(
        createMockWorkOrder({ customer, vehicle, status: WorkOrderStatus.IN_DIAGNOSIS }),
      );

      jest.spyOn(cleanController, 'updateStatus').mockResolvedValue(response);

      const result = await httpController.updateStatus(id, statusRequestStub, currentUser);

      expect(result).toBe(response);
      expect(cleanController.updateStatus).toHaveBeenCalledWith(
        id,
        statusRequestStub,
        currentUser.sub,
      );
    });
  });

  describe('updateServiceStatus', () => {
    it('should delegate to the clean controller with the current user id', async () => {
      const workOrderId = randomUUID();
      const service = createMockService();
      const workOrderService = createMockWorkOrderService({ workOrderId, serviceId: service.id });
      workOrderService.service = service;

      const serviceStatusRequestStub: UpdateWorkOrderServiceStatusRequestDto = {
        status: WorkOrderServiceStatus.COMPLETED,
      };

      const response = WorkOrderPresenter.toServiceItemDataResponse(workOrderService);

      jest.spyOn(cleanController, 'updateServiceStatus').mockResolvedValue(response);

      const result = await httpController.updateServiceStatus(
        workOrderId,
        workOrderService.serviceId,
        serviceStatusRequestStub,
        currentUser,
      );

      expect(result).toBe(response);
      expect(cleanController.updateServiceStatus).toHaveBeenCalledWith(
        workOrderId,
        workOrderService.serviceId,
        serviceStatusRequestStub,
        currentUser.sub,
      );
    });
  });

  describe('getStatusHistory', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const id = randomUUID();

      const response = WorkOrderPresenter.toStatusHistoryListResponse([]);

      jest.spyOn(cleanController, 'getStatusHistory').mockResolvedValue(response);

      const result = await httpController.getStatusHistory(id);

      expect(result).toBe(response);
      expect(cleanController.getStatusHistory).toHaveBeenCalledWith(id);
    });
  });

  describe('findQuotes', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const workOrder = createMockWorkOrder({ customer, vehicle });
      const quote = createMockQuote({ workOrderId: workOrder.id });
      quote.workOrder = workOrder;

      const response = QuotePresenter.toListResponse([quote]);

      jest.spyOn(cleanController, 'findQuotes').mockResolvedValue(response);

      const result = await httpController.findQuotes(workOrder.id);

      expect(result).toBe(response);
      expect(cleanController.findQuotes).toHaveBeenCalledWith(workOrder.id);
    });
  });
});
