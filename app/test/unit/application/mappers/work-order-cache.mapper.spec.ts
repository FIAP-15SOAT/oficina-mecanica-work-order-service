import { randomUUID } from 'node:crypto';

import {
  WORK_ORDER_CACHE_VERSION,
  WorkOrderCacheMapper,
} from '@application/mappers/work-order-cache.mapper';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderPartSupply } from '@domain/entities/work-order-part-supply.entity';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { Address } from '@domain/value-objects/address.vo';
import { Document } from '@domain/value-objects/document.vo';

import { createMockCustomer } from '../../../helpers/customer-mock.factory';
import { createMockPartSupply } from '../../../helpers/part-supply-mock.factory';
import { createMockService } from '../../../helpers/service-mock.factory';
import { createMockUser } from '../../../helpers/user-mock.factory';
import { createMockVehicle } from '../../../helpers/vehicle-mock.factory';
import { createMockWorkOrder } from '../../../helpers/work-order-mock.factory';
import { createMockWorkOrderService } from '../../../helpers/work-order-service-mock.factory';

function roundTrip(workOrder: WorkOrder): WorkOrder {
  return WorkOrderCacheMapper.toDomain(
    JSON.parse(JSON.stringify(WorkOrderCacheMapper.toCache(workOrder))),
  );
}

function createDetailedWorkOrder(): WorkOrder {
  const id = randomUUID();
  const startedAt = new Date('2026-10-20T13:00:00.000Z');

  const serviceItem = createMockWorkOrderService({
    workOrderId: id,
    status: WorkOrderServiceStatus.IN_PROGRESS,
    startedAt,
  });

  serviceItem.service = createMockService({ description: 'Troca de óleo e filtro' });

  const partSupply = createMockPartSupply({ expiresAt: new Date('2027-01-01T00:00:00.000Z') });

  const partSupplyItem = WorkOrderPartSupply.reconstitute({
    workOrderId: id,
    partSupplyId: partSupply.id,
    quantity: 2,
    unitPrice: 45,
    totalPrice: 90,
    createdAt: startedAt,
    updatedAt: startedAt,
  });

  partSupplyItem.partSupply = partSupply;

  return createMockWorkOrder({
    id,
    status: WorkOrderStatus.IN_PROGRESS,
    problemDescription: 'Barulho no motor',
    internalNotes: 'Cliente aguarda na loja',
    mileageAtService: 42_000,
    totalAmount: 190,
    approvedAt: new Date('2026-10-20T12:00:00.000Z'),
    startedAt,
    assignedUserId: randomUUID(),
    customer: createMockCustomer({
      type: CustomerType.COMPANY,
      document: Document.create('12345678000195', CustomerType.COMPANY),
      address: Address.create({
        street: 'Rua das Flores, 100',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01310-100',
      }),
    }),
    vehicle: createMockVehicle({ customer: undefined, color: 'Prata', mileage: 42_000 }),
    services: [serviceItem],
    partSupplies: [partSupplyItem],
  });
}

describe('WorkOrderCacheMapper', () => {
  it.each([
    ['filled dates, address and items', createDetailedWorkOrder],
    [
      'null dates and no items',
      () =>
        createMockWorkOrder({
          customer: createMockCustomer(),
          vehicle: createMockVehicle({ customer: undefined }),
        }),
    ],
  ])('should restore a cached value that equals the original (%s)', (_, build) => {
    const workOrder = build();

    const restored = roundTrip(workOrder);

    expect(restored).toStrictEqual(workOrder);
    expect(restored.createdAt).toBeInstanceOf(Date);
  });

  it('should not carry the assigned user in the cached value', () => {
    const workOrder = createDetailedWorkOrder();
    workOrder.assignedUser = createMockUser({ id: workOrder.assignedUserId! });

    const cached = WorkOrderCacheMapper.toCache(workOrder);

    expect(cached).not.toHaveProperty('assignedUser');
    expect(JSON.stringify(cached)).not.toContain(workOrder.assignedUser.passwordHash);
    expect(cached.assignedUserId).toBe(workOrder.assignedUserId);
  });

  it('should stamp the cached value with the current cache version', () => {
    expect(WorkOrderCacheMapper.toCache(createDetailedWorkOrder()).cacheVersion).toBe(
      WORK_ORDER_CACHE_VERSION,
    );
  });
});
