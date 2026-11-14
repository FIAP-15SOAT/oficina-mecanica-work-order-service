import { randomUUID } from 'node:crypto';
import { UpdateWorkOrderUseCase } from '@application/use-cases/work-order/update-work-order.use-case';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { MechanicAssignmentPolicy } from '@application/services/mechanic-assignment-policy';
import {
  createMockWorkOrder,
  createMockWorkOrderRepository,
} from '../../../../helpers/work-order-mock.factory';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { createMockCache } from '../../../../helpers/cache-mock.factory';

describe('UpdateWorkOrderUseCase', () => {
  let cache: jest.Mocked<ICache>;
  let useCase: UpdateWorkOrderUseCase;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let mechanicAssignmentPolicy: jest.Mocked<MechanicAssignmentPolicy>;

  beforeEach(() => {
    workOrderRepository = createMockWorkOrderRepository();
    mechanicAssignmentPolicy = {
      ensureAssignable: jest.fn(),
    } as unknown as jest.Mocked<MechanicAssignmentPolicy>;
    cache = createMockCache();
    useCase = new UpdateWorkOrderUseCase(workOrderRepository, mechanicAssignmentPolicy, cache);
  });

  it('should update a work order in RECEIVED status', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

    const updated = createMockWorkOrder({ ...wo, problemDescription: 'Barulho na suspensão' });

    workOrderRepository.findById.mockResolvedValue(wo);
    workOrderRepository.update.mockResolvedValue(updated);

    const result = await useCase.execute(wo.id, {
      problemDescription: 'Barulho na suspensão',
      userId: randomUUID(),
    });

    expect(result.problemDescription).toBe('Barulho na suspensão');
    expect(workOrderRepository.update).toHaveBeenCalledTimes(1);
  });

  it('should ask the policy before assigning a mechanic and store the id', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
    const userId = randomUUID();

    workOrderRepository.findById.mockResolvedValue(wo);
    workOrderRepository.update.mockImplementation((workOrder) => Promise.resolve(workOrder));

    const result = await useCase.execute(wo.id, { assignedUserId: userId, userId: randomUUID() });

    expect(result.assignedUserId).toBe(userId);
    expect(mechanicAssignmentPolicy.ensureAssignable).toHaveBeenCalledWith(userId);
    expect(mechanicAssignmentPolicy.ensureAssignable.mock.invocationCallOrder[0]).toBeLessThan(
      workOrderRepository.update.mock.invocationCallOrder[0],
    );
  });

  it('should not ask the policy when no mechanic is informed', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

    workOrderRepository.findById.mockResolvedValue(wo);
    workOrderRepository.update.mockResolvedValue(wo);

    await useCase.execute(wo.id, { problemDescription: 'any', userId: randomUUID() });

    expect(mechanicAssignmentPolicy.ensureAssignable).not.toHaveBeenCalled();
  });

  it('should keep the current mechanic without asking the policy when null is informed', async () => {
    const assignedUserId = randomUUID();
    const wo = createMockWorkOrder({
      status: WorkOrderStatus.RECEIVED,
      assignedUserId,
    });

    workOrderRepository.findById.mockResolvedValue(wo);
    workOrderRepository.update.mockImplementation((workOrder) => Promise.resolve(workOrder));

    const result = await useCase.execute(wo.id, { assignedUserId: null, userId: randomUUID() });

    expect(result.assignedUserId).toBe(assignedUserId);
    expect(mechanicAssignmentPolicy.ensureAssignable).not.toHaveBeenCalled();
  });

  it('should write nothing when the policy refuses the mechanic', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

    workOrderRepository.findById.mockResolvedValue(wo);
    mechanicAssignmentPolicy.ensureAssignable.mockRejectedValue(
      new BusinessRuleViolationException('refused'),
    );

    await expect(
      useCase.execute(wo.id, { assignedUserId: randomUUID(), userId: randomUUID() }),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(workOrderRepository.update).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('should throw ResourceNotFoundException when work order not found', async () => {
    workOrderRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute('bad-id', { problemDescription: 'any', userId: randomUUID() }),
    ).rejects.toThrow(ResourceNotFoundException);
  });

  it('should throw BusinessRuleViolationException when work order is APPROVED', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.APPROVED });

    workOrderRepository.findById.mockResolvedValue(wo);

    await expect(
      useCase.execute(wo.id, { problemDescription: 'any', userId: randomUUID() }),
    ).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should delete the work order cache keys after the commit', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

    workOrderRepository.findById.mockResolvedValue(workOrder);
    workOrderRepository.update.mockResolvedValue(workOrder);

    await useCase.execute(workOrder.id, { problemDescription: 'Barulho', userId: randomUUID() });

    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);

    expect(cache.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      workOrderRepository.update.mock.invocationCallOrder[0],
    );
  });

  it('should not touch the cache when the write fails', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

    workOrderRepository.findById.mockResolvedValue(workOrder);
    workOrderRepository.update.mockRejectedValue(new Error('write failed'));

    await expect(
      useCase.execute(workOrder.id, { problemDescription: 'Barulho', userId: randomUUID() }),
    ).rejects.toThrow('write failed');

    expect(cache.delete).not.toHaveBeenCalled();
  });
});
