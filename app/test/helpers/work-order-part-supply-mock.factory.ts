import { randomUUID } from 'node:crypto';
import { WorkOrderPartSupply } from '@domain/entities/work-order-part-supply.entity';

export function createMockWorkOrderPartSupply(
  overrides: Partial<WorkOrderPartSupply> = {},
): WorkOrderPartSupply {
  const now = new Date();

  return WorkOrderPartSupply.reconstitute({
    workOrderId: randomUUID(),
    partSupplyId: randomUUID(),
    quantity: 1,
    unitPrice: 45,
    totalPrice: 45,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}
