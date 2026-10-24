import { randomUUID } from 'node:crypto';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderProps } from '@domain/entities/work-order.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { WorkOrderNumber } from '@domain/value-objects/work-order-number.vo';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

export function createMockWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  const now = new Date();

  const { customer, vehicle, assignedUser, services, partSupplies, ...dataOverrides } = overrides;

  const wo = WorkOrder.reconstitute({
    id: randomUUID(),
    number: WorkOrderNumber.create('000001'),
    customerId: randomUUID(),
    vehicleId: randomUUID(),
    assignedUserId: null,
    status: WorkOrderStatus.RECEIVED,
    problemDescription: null,
    internalNotes: null,
    mileageAtService: null,
    totalAmount: 0,
    version: 1,
    approvedAt: null,
    rejectedAt: null,
    startedAt: null,
    finishedAt: null,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
    services,
    partSupplies,
    ...(dataOverrides as Partial<WorkOrderProps>),
  });

  if (customer !== undefined) wo.customer = customer;
  if (vehicle !== undefined) wo.vehicle = vehicle;
  if (assignedUser !== undefined) wo.assignedUser = assignedUser;
  return wo;
}

export function createMockWorkOrderRepository(): jest.Mocked<IWorkOrderRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByIdWithDetails: jest.fn(),
    findAllPaginated: jest.fn(),
    update: jest.fn(),
    generateNextNumber: jest.fn(),
    addServiceItems: jest.fn(),
    updateServiceItemStatus: jest.fn(),
    addPartSupplyItems: jest.fn(),
    findByCustomerId: jest.fn().mockResolvedValue([]),
    findByVehicleId: jest.fn().mockResolvedValue([]),
  };
}
