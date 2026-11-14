import { randomUUID } from 'node:crypto';

import { WorkOrderController } from '@interface-adapters/work-order/work-order.controller';

import { WorkOrderPresenter } from '@interface-adapters/work-order/work-order.presenter';

import { CreateWorkOrderRequest } from '@interface-adapters/work-order/requests/create-work-order-request';
import { UpdateWorkOrderRequest } from '@interface-adapters/work-order/requests/update-work-order-request';
import { UpdateWorkOrderStatusRequest } from '@interface-adapters/work-order/requests/update-work-order-status-request';
import { UpdateWorkOrderServiceStatusRequest } from '@interface-adapters/work-order/requests/update-work-order-service-status-request';

import { ICreateWorkOrderUseCase } from '@application/ports/input/work-order/create-work-order.use-case.interface';
import { IFindWorkOrderByIdUseCase } from '@application/ports/input/work-order/find-work-order-by-id.use-case.interface';
import { IFindAllWorkOrdersPaginatedUseCase } from '@application/ports/input/work-order/find-all-work-orders-paginated.use-case.interface';
import { IUpdateWorkOrderUseCase } from '@application/ports/input/work-order/update-work-order.use-case.interface';
import { IUpdateWorkOrderStatusUseCase } from '@application/ports/input/work-order/update-work-order-status.use-case.interface';
import { IUpdateWorkOrderServiceStatusUseCase } from '@application/ports/input/work-order/update-work-order-service-status.use-case.interface';
import { IFindWorkOrderStatusHistoryUseCase } from '@application/ports/input/work-order/find-work-order-status-history.use-case.interface';
import { IFindCatalogItemsUseCase } from '@application/ports/input/catalog/find-catalog-items.use-case.interface';
import { IFindUsersByIdsUseCase } from '@application/ports/input/identity/find-users-by-ids.use-case.interface';
import { FindCatalogItemsOutputDto } from '@application/ports/input/catalog/dto/find-catalog-items.dto';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';

import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { StatusHistory } from '@domain/entities/status-history.entity';

import { createMockCustomer } from '../../../helpers/customer-mock.factory';
import { createMockVehicle } from '../../../helpers/vehicle-mock.factory';
import { createMockWorkOrder } from '../../../helpers/work-order-mock.factory';
import { createMockWorkOrderService } from '../../../helpers/work-order-service-mock.factory';
import { createMockWorkOrderPartSupply } from '../../../helpers/work-order-part-supply-mock.factory';
import {
  createMockInventoryPartSupplyGatewayResponse,
  createMockInventoryServiceGatewayResponse,
} from '../../../helpers/inventory-catalog-gateway-mock.factory';
import { createMockIdentityUserGatewayResponse } from '../../../helpers/identity-users-gateway-mock.factory';

describe('WorkOrderController', () => {
  let controller: WorkOrderController;
  let createUseCase: jest.Mocked<ICreateWorkOrderUseCase>;
  let findByIdUseCase: jest.Mocked<IFindWorkOrderByIdUseCase>;
  let findAllPaginatedUseCase: jest.Mocked<IFindAllWorkOrdersPaginatedUseCase>;
  let updateUseCase: jest.Mocked<IUpdateWorkOrderUseCase>;
  let updateStatusUseCase: jest.Mocked<IUpdateWorkOrderStatusUseCase>;
  let updateServiceStatusUseCase: jest.Mocked<IUpdateWorkOrderServiceStatusUseCase>;
  let findStatusHistoryUseCase: jest.Mocked<IFindWorkOrderStatusHistoryUseCase>;
  let findCatalogItemsUseCase: jest.Mocked<IFindCatalogItemsUseCase>;
  let findUsersByIdsUseCase: jest.Mocked<IFindUsersByIdsUseCase>;

  const customer = createMockCustomer();
  const vehicle = createMockVehicle({ customerId: customer.id });
  const emptyCatalog: FindCatalogItemsOutputDto = { services: [], partsSupplies: [] };

  beforeEach(() => {
    createUseCase = { execute: jest.fn() };
    findByIdUseCase = { execute: jest.fn() };
    findAllPaginatedUseCase = { execute: jest.fn() };
    updateUseCase = { execute: jest.fn() };
    updateStatusUseCase = { execute: jest.fn() };
    updateServiceStatusUseCase = { execute: jest.fn() };
    findStatusHistoryUseCase = { execute: jest.fn() };
    findCatalogItemsUseCase = { execute: jest.fn() };

    findUsersByIdsUseCase = { execute: jest.fn().mockResolvedValue([]) };

    controller = new WorkOrderController(
      createUseCase,
      findByIdUseCase,
      findAllPaginatedUseCase,
      updateUseCase,
      updateStatusUseCase,
      updateServiceStatusUseCase,
      findStatusHistoryUseCase,
      findCatalogItemsUseCase,
      findUsersByIdsUseCase,
    );
  });

  describe('create', () => {
    it('should attach the userId and return the work order wrapped in data', async () => {
      const userId = randomUUID();

      const request: CreateWorkOrderRequest = {
        customerId: customer.id,
        vehicleId: vehicle.id,
      };

      const created = createMockWorkOrder({
        customerId: customer.id,
        vehicleId: vehicle.id,
        customer,
        vehicle,
      });

      createUseCase.execute.mockResolvedValue(created);
      findCatalogItemsUseCase.execute.mockResolvedValue(emptyCatalog);

      const result = await controller.create(request, userId);

      expect(result).toEqual(WorkOrderPresenter.toDataResponse(created, emptyCatalog, []));
      expect(createUseCase.execute).toHaveBeenCalledWith({ ...request, userId });

      expect(findCatalogItemsUseCase.execute).toHaveBeenCalledWith({
        serviceIds: [],
        partSupplyIds: [],
      });
    });
  });

  describe('findAll', () => {
    it('should default page and limit when missing and forward filters', async () => {
      const workOrder = createMockWorkOrder({ customer, vehicle });

      findAllPaginatedUseCase.execute.mockResolvedValue({
        items: [workOrder],
        pagination: { totalRecords: 1, totalPages: 1, page: 1, limit: 10 },
      });

      const result = await controller.findAll({ status: WorkOrderStatus.RECEIVED });

      expect(result).toEqual(
        WorkOrderPresenter.toPaginatedResponse(
          {
            items: [workOrder],
            pagination: { totalRecords: 1, totalPages: 1, page: 1, limit: 10 },
          },
          [],
        ),
      );

      expect(findAllPaginatedUseCase.execute).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        status: WorkOrderStatus.RECEIVED,
      });
    });

    it('should resolve the users of the whole page in one lookup', async () => {
      const mechanic = createMockIdentityUserGatewayResponse();
      const otherMechanic = createMockIdentityUserGatewayResponse();

      const workOrders = [
        createMockWorkOrder({ customer, vehicle, assignedUserId: mechanic.id }),
        createMockWorkOrder({ customer, vehicle, assignedUserId: otherMechanic.id }),
        createMockWorkOrder({ customer, vehicle, assignedUserId: null }),
      ];

      const page = {
        items: workOrders,
        pagination: { totalRecords: 3, totalPages: 1, page: 1, limit: 10 },
      };

      findAllPaginatedUseCase.execute.mockResolvedValue(page);
      findUsersByIdsUseCase.execute.mockResolvedValue([mechanic, otherMechanic]);

      const result = await controller.findAll({});

      expect(findUsersByIdsUseCase.execute).toHaveBeenCalledTimes(1);
      expect(findUsersByIdsUseCase.execute).toHaveBeenCalledWith([mechanic.id, otherMechanic.id]);

      expect(result).toEqual(
        WorkOrderPresenter.toPaginatedResponse(page, [mechanic, otherMechanic]),
      );
    });

    it('should forward provided page, limit and sort', async () => {
      findAllPaginatedUseCase.execute.mockResolvedValue({
        items: [],
        pagination: { totalRecords: 0, totalPages: 0, page: 2, limit: 5 },
      });

      await controller.findAll({ page: 2, limit: 5, sort: 'createdAt:asc' });

      expect(findAllPaginatedUseCase.execute).toHaveBeenCalledWith({
        page: 2,
        limit: 5,
        sort: 'createdAt:asc',
      });
    });
  });

  describe('findOne', () => {
    it('should read the catalog of the work order items and present the work order with it', async () => {
      const service = createMockInventoryServiceGatewayResponse();
      const partSupply = createMockInventoryPartSupplyGatewayResponse();

      const workOrder = createMockWorkOrder({
        customer,
        vehicle,
        services: [createMockWorkOrderService({ serviceId: service.id })],
        partSupplies: [createMockWorkOrderPartSupply({ partSupplyId: partSupply.id })],
      });

      const catalog = { services: [service], partsSupplies: [partSupply] };

      findByIdUseCase.execute.mockResolvedValue(workOrder);
      findCatalogItemsUseCase.execute.mockResolvedValue(catalog);

      const result = await controller.findOne(workOrder.id);

      expect(findByIdUseCase.execute).toHaveBeenCalledWith(workOrder.id);

      expect(findCatalogItemsUseCase.execute).toHaveBeenCalledWith({
        serviceIds: [service.id],
        partSupplyIds: [partSupply.id],
      });

      expect(result).toEqual(WorkOrderPresenter.toDataResponse(workOrder, catalog, []));
    });
  });

  describe('findOne users', () => {
    it('should resolve the mechanic of the work order from the identity', async () => {
      const mechanic = createMockIdentityUserGatewayResponse();
      const workOrder = createMockWorkOrder({ customer, vehicle, assignedUserId: mechanic.id });

      findByIdUseCase.execute.mockResolvedValue(workOrder);
      findCatalogItemsUseCase.execute.mockResolvedValue(emptyCatalog);
      findUsersByIdsUseCase.execute.mockResolvedValue([mechanic]);

      const result = await controller.findOne(workOrder.id);

      expect(findUsersByIdsUseCase.execute).toHaveBeenCalledWith([mechanic.id]);

      expect(result).toEqual(
        WorkOrderPresenter.toDataResponse(workOrder, emptyCatalog, [mechanic]),
      );
    });
  });

  describe('users read before the write', () => {
    it('should read the mechanic of the input before creating the work order', async () => {
      const mechanic = createMockIdentityUserGatewayResponse();

      const created = createMockWorkOrder({
        customer,
        vehicle,
        assignedUserId: mechanic.id,
      });

      createUseCase.execute.mockResolvedValue(created);
      findCatalogItemsUseCase.execute.mockResolvedValue(emptyCatalog);
      findUsersByIdsUseCase.execute.mockResolvedValue([mechanic]);

      const result = await controller.create(
        { customerId: customer.id, vehicleId: vehicle.id, assignedUserId: mechanic.id },
        randomUUID(),
      );

      expect(findUsersByIdsUseCase.execute).toHaveBeenCalledWith([mechanic.id]);
      expect(result).toEqual(WorkOrderPresenter.toDataResponse(created, emptyCatalog, [mechanic]));
    });

    it('should read the mechanic of the input before updating the work order', async () => {
      const mechanic = createMockIdentityUserGatewayResponse();
      const updated = createMockWorkOrder({ customer, vehicle, assignedUserId: mechanic.id });

      updateUseCase.execute.mockResolvedValue(updated);
      findCatalogItemsUseCase.execute.mockResolvedValue(emptyCatalog);
      findUsersByIdsUseCase.execute.mockResolvedValue([mechanic]);

      await controller.update(updated.id, { assignedUserId: mechanic.id }, randomUUID());

      expect(findByIdUseCase.execute).not.toHaveBeenCalled();
      expect(findUsersByIdsUseCase.execute).toHaveBeenCalledWith([mechanic.id]);
    });

    it('should read the current mechanic before updating when the input has none', async () => {
      const mechanic = createMockIdentityUserGatewayResponse();
      const current = createMockWorkOrder({ customer, vehicle, assignedUserId: mechanic.id });

      findByIdUseCase.execute.mockResolvedValue(current);
      updateUseCase.execute.mockResolvedValue(current);
      findCatalogItemsUseCase.execute.mockResolvedValue(emptyCatalog);
      findUsersByIdsUseCase.execute.mockResolvedValue([mechanic]);

      await controller.update(current.id, { problemDescription: 'Ruído' }, randomUUID());

      expect(findUsersByIdsUseCase.execute).toHaveBeenCalledWith([mechanic.id]);
    });

    it('should fail the creation without writing when the identity is unavailable', async () => {
      findUsersByIdsUseCase.execute.mockRejectedValue(
        new ServiceIntegrationException('Serviço de destino indisponível'),
      );

      await expect(
        controller.create({ customerId: customer.id, vehicleId: vehicle.id }, randomUUID()),
      ).rejects.toBeInstanceOf(ServiceIntegrationException);

      expect(createUseCase.execute).not.toHaveBeenCalled();
    });

    it('should fail the update without writing when the identity is unavailable', async () => {
      findByIdUseCase.execute.mockResolvedValue(createMockWorkOrder({ customer, vehicle }));

      findUsersByIdsUseCase.execute.mockRejectedValue(
        new ServiceIntegrationException('Serviço de destino indisponível'),
      );

      await expect(
        controller.update(randomUUID(), { problemDescription: 'Ruído' }, randomUUID()),
      ).rejects.toBeInstanceOf(ServiceIntegrationException);

      expect(updateUseCase.execute).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should attach the userId and return the updated work order wrapped in data', async () => {
      const userId = randomUUID();
      const request: UpdateWorkOrderRequest = { problemDescription: 'Barulho no motor' };

      const updated = createMockWorkOrder({
        customer,
        vehicle,
        problemDescription: request.problemDescription,
      });

      findByIdUseCase.execute.mockResolvedValue(updated);
      updateUseCase.execute.mockResolvedValue(updated);
      findCatalogItemsUseCase.execute.mockResolvedValue(emptyCatalog);

      const result = await controller.update(updated.id, request, userId);

      expect(result).toEqual(WorkOrderPresenter.toDataResponse(updated, emptyCatalog, []));
      expect(updateUseCase.execute).toHaveBeenCalledWith(updated.id, { ...request, userId });
    });
  });

  describe('updateStatus', () => {
    it('should read the catalog before changing the status and present the result with it', async () => {
      const userId = randomUUID();
      const service = createMockInventoryServiceGatewayResponse();
      const items = [createMockWorkOrderService({ serviceId: service.id })];
      const catalog = { services: [service], partsSupplies: [] };

      const request: UpdateWorkOrderStatusRequest = {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        notes: 'Iniciando diagnóstico',
      };

      const workOrder = createMockWorkOrder({ customer, vehicle, services: items });

      const updated = createMockWorkOrder({
        id: workOrder.id,
        customer,
        vehicle,
        services: items,
        status: WorkOrderStatus.IN_DIAGNOSIS,
      });

      findByIdUseCase.execute.mockResolvedValue(workOrder);
      findCatalogItemsUseCase.execute.mockResolvedValue(catalog);
      updateStatusUseCase.execute.mockResolvedValue(updated);

      const result = await controller.updateStatus(workOrder.id, request, userId);

      expect(findByIdUseCase.execute).toHaveBeenCalledWith(workOrder.id);

      expect(findCatalogItemsUseCase.execute).toHaveBeenCalledWith({
        serviceIds: [service.id],
        partSupplyIds: [],
      });

      expect(updateStatusUseCase.execute).toHaveBeenCalledWith(workOrder.id, {
        status: request.status,
        notes: request.notes,
        userId,
      });

      expect(result).toEqual(WorkOrderPresenter.toDataResponse(updated, catalog, []));
    });

    it('should answer 503 without changing the status when the catalog is unavailable', async () => {
      const workOrder = createMockWorkOrder({ customer, vehicle });

      findByIdUseCase.execute.mockResolvedValue(workOrder);

      findCatalogItemsUseCase.execute.mockRejectedValue(
        new ServiceIntegrationException('Serviço de destino indisponível'),
      );

      await expect(
        controller.updateStatus(
          workOrder.id,
          { status: WorkOrderStatus.IN_DIAGNOSIS },
          randomUUID(),
        ),
      ).rejects.toBeInstanceOf(ServiceIntegrationException);

      expect(updateStatusUseCase.execute).not.toHaveBeenCalled();
    });
  });

  describe('updateServiceStatus', () => {
    it('should read the catalog before changing the service status and present the result with it', async () => {
      const userId = randomUUID();
      const workOrderId = randomUUID();
      const service = createMockInventoryServiceGatewayResponse();
      const catalog = { services: [service], partsSupplies: [] };

      const request: UpdateWorkOrderServiceStatusRequest = {
        status: WorkOrderServiceStatus.COMPLETED,
      };

      const workOrderService = createMockWorkOrderService({
        workOrderId,
        serviceId: service.id,
        status: WorkOrderServiceStatus.COMPLETED,
      });

      findCatalogItemsUseCase.execute.mockResolvedValue(catalog);
      updateServiceStatusUseCase.execute.mockResolvedValue(workOrderService);

      const result = await controller.updateServiceStatus(workOrderId, service.id, request, userId);

      expect(findCatalogItemsUseCase.execute).toHaveBeenCalledWith({
        serviceIds: [service.id],
        partSupplyIds: [],
      });

      expect(updateServiceStatusUseCase.execute).toHaveBeenCalledWith({
        workOrderId,
        serviceId: service.id,
        status: request.status,
        userId,
      });

      expect(result).toEqual(
        WorkOrderPresenter.toServiceItemDataResponse(workOrderService, catalog),
      );
    });

    it('should answer 503 without changing the service status when the catalog is unavailable', async () => {
      findCatalogItemsUseCase.execute.mockRejectedValue(
        new ServiceIntegrationException('Serviço de destino indisponível'),
      );

      await expect(
        controller.updateServiceStatus(
          randomUUID(),
          randomUUID(),
          { status: WorkOrderServiceStatus.IN_PROGRESS },
          randomUUID(),
        ),
      ).rejects.toBeInstanceOf(ServiceIntegrationException);

      expect(updateServiceStatusUseCase.execute).not.toHaveBeenCalled();
    });
  });

  describe('getStatusHistory', () => {
    it('should return the status history wrapped in data', async () => {
      const history: StatusHistory[] = [];

      findStatusHistoryUseCase.execute.mockResolvedValue(history);

      const result = await controller.getStatusHistory(randomUUID());

      expect(result).toEqual(WorkOrderPresenter.toStatusHistoryListResponse(history, []));
    });

    it('should resolve the history authors with distinct ids', async () => {
      const author = createMockIdentityUserGatewayResponse();
      const workOrderId = randomUUID();

      const history = [
        StatusHistory.create({
          workOrderId,
          changedById: author.id,
          newStatus: WorkOrderStatus.RECEIVED,
        }),
        StatusHistory.create({
          workOrderId,
          changedById: author.id,
          previousStatus: WorkOrderStatus.RECEIVED,
          newStatus: WorkOrderStatus.IN_DIAGNOSIS,
        }),
        StatusHistory.create({
          workOrderId,
          previousStatus: WorkOrderStatus.IN_DIAGNOSIS,
          newStatus: WorkOrderStatus.AWAITING_APPROVAL,
        }),
      ];

      findStatusHistoryUseCase.execute.mockResolvedValue(history);
      findUsersByIdsUseCase.execute.mockResolvedValue([author]);

      const result = await controller.getStatusHistory(workOrderId);

      expect(findUsersByIdsUseCase.execute).toHaveBeenCalledWith([author.id]);
      expect(result).toEqual(WorkOrderPresenter.toStatusHistoryListResponse(history, [author]));
    });

    it('should forward the work order id to the use case', async () => {
      const id = randomUUID();

      findStatusHistoryUseCase.execute.mockResolvedValue([]);

      await controller.getStatusHistory(id);

      expect(findStatusHistoryUseCase.execute).toHaveBeenCalledWith(id);
    });
  });
});
