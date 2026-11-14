import { randomUUID } from 'node:crypto';

import { WorkOrderPresenter } from '@interface-adapters/work-order/work-order.presenter';

import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { Plate } from '@domain/value-objects/plate.vo';
import { WorkOrderNumber } from '@domain/value-objects/work-order-number.vo';

import { FindCatalogItemsOutputDto } from '@application/ports/input/catalog/dto/find-catalog-items.dto';

import {
  createMockInventoryPartSupplyGatewayResponse,
  createMockInventoryServiceGatewayResponse,
} from '../../../helpers/inventory-catalog-gateway-mock.factory';
import { createMockWorkOrder } from '../../../helpers/work-order-mock.factory';
import { createMockWorkOrderService } from '../../../helpers/work-order-service-mock.factory';
import { createMockWorkOrderPartSupply } from '../../../helpers/work-order-part-supply-mock.factory';
import { createMockCustomer } from '../../../helpers/customer-mock.factory';
import { createMockVehicle } from '../../../helpers/vehicle-mock.factory';
import { createMockIdentityUserGatewayResponse } from '../../../helpers/identity-users-gateway-mock.factory';
import { createMockStatusHistory } from '../../../helpers/status-history-mock.factory';

describe('WorkOrderPresenter', () => {
  const emptyCatalog: FindCatalogItemsOutputDto = { services: [], partsSupplies: [] };

  describe('toResponse', () => {
    it('should format a work order correctly', () => {
      const now = new Date();
      const customer = createMockCustomer();
      const vehicle = createMockVehicle({ customerId: customer.id });

      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('000001'),
        customerId: customer.id,
        vehicleId: vehicle.id,
        assignedUserId: null,
        status: WorkOrderStatus.IN_DIAGNOSIS,
        problemDescription: 'Some problem',
        internalNotes: 'Some notes',
        mileageAtService: 50000,
        totalAmount: 250.0,
        version: 0,
        approvedAt: now,
        rejectedAt: null,
        startedAt: now,
        finishedAt: null,
        deliveredAt: null,
        createdAt: now,
        updatedAt: now,
      });
      workOrder.customer = customer;
      workOrder.vehicle = vehicle;

      const response = WorkOrderPresenter.toResponse(workOrder, emptyCatalog, []);

      expect(response.id).toBe(workOrder.id);
      expect(response.number).toBe(workOrder.number.toString());
      expect(response.customer.id).toBe(customer.id);
      expect(response.vehicle.id).toBe(vehicle.id);
      expect(response.assignedUser).toBeNull();
      expect(response.status).toBe(workOrder.status);
      expect(response.totalAmount).toBe(workOrder.totalAmount);
    });

    it('should show the assigned user read in the identity', () => {
      const user = createMockIdentityUserGatewayResponse();
      const workOrder = createMockWorkOrder({
        customer: createMockCustomer(),
        vehicle: createMockVehicle(),
        assignedUserId: user.id,
      });

      const response = WorkOrderPresenter.toResponse(workOrder, emptyCatalog, [user]);

      expect(response.assignedUser).toEqual({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    });

    it('should show null for an assigned user the identity does not find', () => {
      const workOrder = createMockWorkOrder({
        customer: createMockCustomer(),
        vehicle: createMockVehicle(),
        assignedUserId: randomUUID(),
      });

      const response = WorkOrderPresenter.toResponse(workOrder, emptyCatalog, []);

      expect(response.assignedUser).toBeNull();
    });

    it('should format a work order with nested relations correctly', () => {
      const customer = createMockCustomer({ name: 'Customer' });
      const vehicle = createMockVehicle({ plate: Plate.create('ABC-1234') });
      const user = createMockIdentityUserGatewayResponse({ name: 'User' });

      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        customerId: customer.id,
        vehicleId: vehicle.id,
        number: WorkOrderNumber.create('000001'),
        assignedUserId: user.id,
        status: WorkOrderStatus.RECEIVED,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 0,
        approvedAt: null,
        rejectedAt: null,
        startedAt: null,
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      workOrder.customer = customer;
      workOrder.vehicle = vehicle;

      const response = WorkOrderPresenter.toResponse(workOrder, emptyCatalog, [user]);

      expect(response.customer.name).toBe('Customer');
      expect(response.vehicle.plate).toBe('ABC1234');
      expect(response.assignedUser!.name).toBe('User');
    });
  });

  describe('toDataResponse', () => {
    it('should wrap response in data property', () => {
      const customer = createMockCustomer();
      const vehicle = createMockVehicle({ customerId: customer.id });
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('001'),
        customerId: customer.id,
        vehicleId: vehicle.id,
        assignedUserId: null,
        status: WorkOrderStatus.RECEIVED,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 0,
        approvedAt: null,
        rejectedAt: null,
        startedAt: null,
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      workOrder.customer = customer;
      workOrder.vehicle = vehicle;
      const result = WorkOrderPresenter.toDataResponse(workOrder, emptyCatalog, []);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBe(workOrder.id);
    });
  });

  describe('toPaginatedResponse', () => {
    it('should format paginated results', () => {
      const customer = createMockCustomer();
      const vehicle = createMockVehicle({ customerId: customer.id });
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('001'),
        customerId: customer.id,
        vehicleId: vehicle.id,
        assignedUserId: null,
        status: WorkOrderStatus.RECEIVED,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 0,
        approvedAt: null,
        rejectedAt: null,
        startedAt: null,
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      workOrder.customer = customer;
      workOrder.vehicle = vehicle;
      const paginatedResult = {
        items: [workOrder],
        pagination: { totalRecords: 1, totalPages: 1, page: 1, limit: 10 },
      };

      const response = WorkOrderPresenter.toPaginatedResponse(paginatedResult, []);

      expect(response.data).toHaveLength(1);
      expect(response.pagination).toEqual(paginatedResult.pagination);
      expect(response.data[0].services).toBeUndefined();
      expect(response.data[0].partSupplies).toBeUndefined();
    });
  });

  describe('toSummaryResponse', () => {
    it('should format work order without services or partSupplies', () => {
      const customer = createMockCustomer();
      const vehicle = createMockVehicle({ customerId: customer.id });
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('001'),
        customerId: customer.id,
        vehicleId: vehicle.id,
        assignedUserId: null,
        status: WorkOrderStatus.RECEIVED,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 0,
        approvedAt: null,
        rejectedAt: null,
        startedAt: null,
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      workOrder.customer = customer;
      workOrder.vehicle = vehicle;

      const response = WorkOrderPresenter.toSummaryResponse(workOrder, []);

      expect(response.id).toBe(workOrder.id);
      expect(response.services).toBeUndefined();
      expect(response.partSupplies).toBeUndefined();
    });
  });

  describe('toResponse with services and partSupplies', () => {
    it('should present the item display fields read from the catalog', () => {
      const service = createMockInventoryServiceGatewayResponse();
      const partSupply = createMockInventoryPartSupplyGatewayResponse();

      const workOrder = createMockWorkOrder({
        customer: createMockCustomer(),
        vehicle: createMockVehicle(),
        services: [createMockWorkOrderService({ serviceId: service.id })],
        partSupplies: [createMockWorkOrderPartSupply({ partSupplyId: partSupply.id })],
      });

      const response = WorkOrderPresenter.toResponse(
        workOrder,
        { services: [service], partsSupplies: [partSupply] },
        [],
      );

      expect(response.services![0]).toMatchObject({
        id: service.id,
        name: service.name,
        description: service.description,
      });

      expect(response.partSupplies![0]).toMatchObject({
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
      const serviceItem = createMockWorkOrderService({
        quantity: 2,
        unitPrice: 100,
        totalPrice: 200,
      });

      const partSupplyItem = createMockWorkOrderPartSupply({
        quantity: 3,
        unitPrice: 25,
        totalPrice: 75,
      });

      const workOrder = createMockWorkOrder({
        customer: createMockCustomer(),
        vehicle: createMockVehicle(),
        services: [serviceItem],
        partSupplies: [partSupplyItem],
      });

      const response = WorkOrderPresenter.toResponse(workOrder, emptyCatalog, []);

      expect(response.services![0]).toMatchObject({
        id: serviceItem.serviceId,
        name: null,
        description: null,
        quantity: 2,
        unitPrice: 100,
        totalPrice: 200,
      });

      expect(response.partSupplies![0]).toEqual({
        id: partSupplyItem.partSupplyId,
        name: null,
        description: null,
        sku: null,
        partNumber: null,
        category: null,
        unit: null,
        quantity: 3,
        unitPrice: 25,
        totalPrice: 75,
      });
    });
  });

  describe('toServiceItemDataResponse', () => {
    it('should wrap the service item read from the catalog in data', () => {
      const service = createMockInventoryServiceGatewayResponse();
      const item = createMockWorkOrderService({ serviceId: service.id });

      const result = WorkOrderPresenter.toServiceItemDataResponse(item, {
        services: [service],
        partsSupplies: [],
      });

      expect(result.data).toMatchObject({
        id: service.id,
        name: service.name,
        status: item.status,
      });
    });
  });

  describe('toStatusHistoryListResponse', () => {
    it('should return empty data array when history is empty', () => {
      const result = WorkOrderPresenter.toStatusHistoryListResponse([], []);

      expect(result.data).toEqual([]);
    });

    it('should map all fields of a status history entry with no changedBy', () => {
      const now = new Date();

      const entry = createMockStatusHistory({
        previousStatus: WorkOrderStatus.RECEIVED,
        newStatus: WorkOrderStatus.IN_DIAGNOSIS,
        notes: 'Diagnóstico iniciado',
        createdAt: now,
      });

      const result = WorkOrderPresenter.toStatusHistoryListResponse([entry], []);

      expect(result.data).toHaveLength(1);

      const item = result.data[0];

      expect(item.id).toBe(entry.id);
      expect(item.previousStatus).toBe(WorkOrderStatus.RECEIVED);
      expect(item.newStatus).toBe(WorkOrderStatus.IN_DIAGNOSIS);
      expect(item.notes).toBe('Diagnóstico iniciado');
      expect(item.createdAt).toBe(now);
      expect(item.changedBy).toBeNull();
    });

    it('should show the history author read in the identity', () => {
      const user = createMockIdentityUserGatewayResponse({ name: 'Mecânico' });
      const entry = createMockStatusHistory({ previousStatus: null, changedById: user.id });

      const result = WorkOrderPresenter.toStatusHistoryListResponse([entry], [user]);

      const changedBy = result.data[0].changedBy!;

      expect(changedBy).toEqual({
        id: user.id,
        name: 'Mecânico',
        email: user.email,
        role: user.role,
      });
    });

    it('should show null for a history author the identity does not find', () => {
      const entry = createMockStatusHistory({ changedById: randomUUID() });

      const result = WorkOrderPresenter.toStatusHistoryListResponse([entry], []);

      expect(result.data[0].changedBy).toBeNull();
    });

    it('should map multiple entries preserving order', () => {
      const entry1 = createMockStatusHistory({ newStatus: WorkOrderStatus.IN_DIAGNOSIS });

      const entry2 = createMockStatusHistory({ newStatus: WorkOrderStatus.APPROVED });

      const result = WorkOrderPresenter.toStatusHistoryListResponse([entry1, entry2], []);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].newStatus).toBe(WorkOrderStatus.IN_DIAGNOSIS);
      expect(result.data[1].newStatus).toBe(WorkOrderStatus.APPROVED);
    });
  });
});
