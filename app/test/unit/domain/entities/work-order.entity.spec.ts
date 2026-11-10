import { WorkOrder } from '@domain/entities/work-order.entity';
import { User } from '@domain/entities/user.entity';
import { WorkOrderNumber } from '@domain/value-objects/work-order-number.vo';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { EntityNotFoundException } from '@domain/exceptions/entity-not-found.exception';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { UserRole } from '@domain/enums/user-role.enum';
import { createMockWorkOrderService } from '../../../helpers/work-order-service-mock.factory';
import {
  createMockQuote,
  createMockQuoteService,
  createMockQuotePartSupply,
} from '../../../helpers/quote-mock.factory';
import { createMockWorkOrder } from '../../../helpers/work-order-mock.factory';
import { randomUUID } from 'node:crypto';

describe('WorkOrder Entity', () => {
  const baseProps = {
    customerId: '550e8400-e29b-41d4-a716-446655440001',
    vehicleId: '550e8400-e29b-41d4-a716-446655440002',
    number: '000001',
  };

  describe('create()', () => {
    it('should create a work order with RECEIVED status and zero total', () => {
      const workOrder = WorkOrder.create(baseProps);

      expect(workOrder.id).toBeDefined();
      expect(workOrder.status).toBe(WorkOrderStatus.RECEIVED);
      expect(workOrder.totalAmount).toBe(0);
      expect(workOrder.number.toString()).toBe('000001');
      expect(workOrder.customerId).toBe('550e8400-e29b-41d4-a716-446655440001');
      expect(workOrder.vehicleId).toBe('550e8400-e29b-41d4-a716-446655440002');
      expect(workOrder.approvedAt).toBeNull();
      expect(workOrder.startedAt).toBeNull();
      expect(workOrder.finishedAt).toBeNull();
      expect(workOrder.deliveredAt).toBeNull();
    });

    it('should keep the id given by the caller', () => {
      const id = randomUUID();

      const workOrder = WorkOrder.create({ ...baseProps, id });

      expect(workOrder.id).toBe(id);
    });

    it('should throw DomainValidationException when customerId is empty', () => {
      expect(() => WorkOrder.create({ ...baseProps, customerId: '' })).toThrow(
        DomainValidationException,
      );
    });

    it('should throw DomainValidationException when vehicleId is empty', () => {
      expect(() => WorkOrder.create({ ...baseProps, vehicleId: '' })).toThrow(
        DomainValidationException,
      );
    });

    it('should throw DomainValidationException when mileage is negative', () => {
      expect(() => WorkOrder.create({ ...baseProps, mileageAtService: -1 })).toThrow(
        DomainValidationException,
      );
    });

    it('should accept zero mileage', () => {
      const workOrder = WorkOrder.create({ ...baseProps, mileageAtService: 0 });
      expect(workOrder.mileageAtService).toBe(0);
    });

    it('should throw DomainValidationException when customerId is not a valid UUID', () => {
      expect(() => WorkOrder.create({ ...baseProps, customerId: 'not-a-uuid' })).toThrow(
        DomainValidationException,
      );
    });

    it('should throw DomainValidationException when vehicleId is not a valid UUID', () => {
      expect(() => WorkOrder.create({ ...baseProps, vehicleId: 'not-a-uuid' })).toThrow(
        DomainValidationException,
      );
    });

    it('should throw DomainValidationException when problemDescription exceeds 2000 chars', () => {
      expect(() =>
        WorkOrder.create({ ...baseProps, problemDescription: 'A'.repeat(2001) }),
      ).toThrow(DomainValidationException);
    });

    it('should throw DomainValidationException when internalNotes exceed 2000 chars', () => {
      expect(() => WorkOrder.create({ ...baseProps, internalNotes: 'N'.repeat(2001) })).toThrow(
        DomainValidationException,
      );
    });
    it('should throw BusinessRuleViolationException when assigned user is not a mechanic', () => {
      const nonMechanic = { id: 'u1', name: 'John', role: UserRole.ADMIN, isActive: true };
      expect(() =>
        WorkOrder.create({ ...baseProps, assignedUser: nonMechanic as unknown as User }),
      ).toThrow(BusinessRuleViolationException);
    });

    it('should throw BusinessRuleViolationException when assigned user is inactive', () => {
      const inactiveMechanic = { id: 'u1', name: 'John', role: UserRole.MECHANIC, isActive: false };
      expect(() =>
        WorkOrder.create({ ...baseProps, assignedUser: inactiveMechanic as unknown as User }),
      ).toThrow(BusinessRuleViolationException);
    });

    it('should allow creating with mechanic', () => {
      const mechanic = { id: 'u1', name: 'John', role: UserRole.MECHANIC, isActive: true };
      const workOrder = WorkOrder.create({
        ...baseProps,
        assignedUser: mechanic as unknown as User,
      });
      expect(workOrder.assignedUserId).toBe(mechanic.id);
      expect(workOrder.assignedUser).toEqual(mechanic);
    });
  });

  describe('update()', () => {
    it('should update fields in RECEIVED status', () => {
      const workOrder = WorkOrder.create(baseProps);
      workOrder.update({ problemDescription: 'Barulho no motor', mileageAtService: 50000 });

      expect(workOrder.problemDescription).toBe('Barulho no motor');
      expect(workOrder.mileageAtService).toBe(50000);
    });

    it('should update fields in IN_DIAGNOSIS status', () => {
      const workOrder = WorkOrder.create(baseProps);
      workOrder.changeStatus(WorkOrderStatus.IN_DIAGNOSIS);
      workOrder.update({ internalNotes: 'Verificar correia' });

      expect(workOrder.internalNotes).toBe('Verificar correia');
    });

    it('should throw BusinessRuleViolationException when updating AWAITING_APPROVAL status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });

      expect(() => workOrder.update({ problemDescription: 'test' })).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should update updatedAt on change', () => {
      const workOrder = WorkOrder.create(baseProps);
      const before = workOrder.updatedAt;
      workOrder.update({ mileageAtService: 100 });
      expect(workOrder.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('should update assignedUserId and assignedUser', () => {
      const workOrder = WorkOrder.create(baseProps);
      const mechanic = { id: 'u3', name: 'Joe', role: UserRole.MECHANIC, isActive: true };
      workOrder.update({ assignedUser: mechanic as unknown as User });
      expect(workOrder.assignedUserId).toBe(mechanic.id);
    });

    it('should throw BusinessRuleViolationException when updating with non-mechanic', () => {
      const workOrder = WorkOrder.create(baseProps);
      const nonMechanic = { id: 'u3', name: 'Joe', role: UserRole.ADMIN, isActive: true };
      expect(() => workOrder.update({ assignedUser: nonMechanic as unknown as User })).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should throw BusinessRuleViolationException when updating with inactive mechanic', () => {
      const workOrder = WorkOrder.create(baseProps);
      const inactiveMechanic = { id: 'u3', name: 'Joe', role: UserRole.MECHANIC, isActive: false };
      expect(() => workOrder.update({ assignedUser: inactiveMechanic as unknown as User })).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should clear assignedUser when null is passed', () => {
      const mechanic = { id: 'u4', name: 'Joe', role: UserRole.MECHANIC, isActive: true };
      const workOrder = WorkOrder.create({
        ...baseProps,
        assignedUser: mechanic as unknown as User,
      });
      expect(workOrder.assignedUserId).toBe('u4');

      workOrder.update({ assignedUser: null });

      expect(workOrder.assignedUserId).toBeNull();
      expect(workOrder.assignedUser).toBeNull();
    });

    it('should throw DomainValidationException for invalid fields on update', () => {
      const workOrder = WorkOrder.create(baseProps);
      expect(() => workOrder.update({ mileageAtService: -100 })).toThrow(DomainValidationException);
    });

    it('should set problemDescription to null when update receives null', () => {
      const workOrder = WorkOrder.create({
        ...baseProps,
        problemDescription: 'Descrição inicial',
      });

      workOrder.update({ problemDescription: null });

      expect(workOrder.problemDescription).toBeNull();
    });

    it('should set internalNotes to null when update receives null', () => {
      const workOrder = WorkOrder.create({
        ...baseProps,
        internalNotes: 'Nota inicial',
      });

      workOrder.update({ internalNotes: null });

      expect(workOrder.internalNotes).toBeNull();
    });
  });

  describe('changeStatus()', () => {
    it('should transition RECEIVED -> IN_DIAGNOSIS', () => {
      const workOrder = WorkOrder.create(baseProps);
      workOrder.changeStatus(WorkOrderStatus.IN_DIAGNOSIS);
      expect(workOrder.status).toBe(WorkOrderStatus.IN_DIAGNOSIS);
    });

    it('should transition RECEIVED -> CANCELLED with notes', () => {
      const workOrder = WorkOrder.create(baseProps);
      workOrder.changeStatus(WorkOrderStatus.CANCELLED, 'Cancelado pelo cliente');
      expect(workOrder.status).toBe(WorkOrderStatus.CANCELLED);
    });

    it('should transition IN_DIAGNOSIS -> CANCELLED with notes', () => {
      const workOrder = WorkOrder.create(baseProps);
      workOrder.changeStatus(WorkOrderStatus.IN_DIAGNOSIS);
      workOrder.changeStatus(WorkOrderStatus.CANCELLED, 'Cancelado na oficina');
      expect(workOrder.status).toBe(WorkOrderStatus.CANCELLED);
    });

    it('should transition AWAITING_APPROVAL -> CANCELLED with notes', () => {
      const workOrder = WorkOrder.create(baseProps);
      workOrder.changeStatus(WorkOrderStatus.IN_DIAGNOSIS);
      workOrder.changeStatus(WorkOrderStatus.AWAITING_APPROVAL);
      workOrder.changeStatus(WorkOrderStatus.CANCELLED, 'Cliente desistiu');
      expect(workOrder.status).toBe(WorkOrderStatus.CANCELLED);
    });

    it('should throw when transitioning to CANCELLED without notes', () => {
      const workOrder = WorkOrder.create(baseProps);
      expect(() => workOrder.changeStatus(WorkOrderStatus.CANCELLED)).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should throw for disallowed transition RECEIVED -> COMPLETED', () => {
      const workOrder = WorkOrder.create(baseProps);
      expect(() => workOrder.changeStatus(WorkOrderStatus.COMPLETED)).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should throw when transitioning from terminal status CANCELLED', () => {
      const workOrder = WorkOrder.create(baseProps);
      workOrder.changeStatus(WorkOrderStatus.CANCELLED, 'notes');

      expect(() => workOrder.changeStatus(WorkOrderStatus.IN_DIAGNOSIS)).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should throw when transitioning from terminal status DELIVERED', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.COMPLETED });
      workOrder.changeStatus(WorkOrderStatus.DELIVERED);

      expect(() => workOrder.changeStatus(WorkOrderStatus.IN_DIAGNOSIS)).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should throw when transitioning to same status', () => {
      const workOrder = WorkOrder.create(baseProps);
      expect(() => workOrder.changeStatus(WorkOrderStatus.RECEIVED)).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should set rejectedAt when transitioning to REJECTED (updateTimestampsForStatus)', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });
      workOrder.changeStatus(WorkOrderStatus.REJECTED);

      expect(workOrder.rejectedAt).toBeInstanceOf(Date);
    });

    it('should set approvedAt when transitioning to APPROVED (updateTimestampsForStatus)', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });
      workOrder.changeStatus(WorkOrderStatus.APPROVED);

      expect(workOrder.approvedAt).toBeInstanceOf(Date);
    });

    it('should set startedAt when transitioning to IN_PROGRESS (updateTimestampsForStatus)', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.APPROVED });
      workOrder.changeStatus(WorkOrderStatus.IN_PROGRESS);

      expect(workOrder.startedAt).toBeInstanceOf(Date);
    });

    it('should set finishedAt when transitioning to COMPLETED (updateTimestampsForStatus)', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_PROGRESS });
      workOrder.changeStatus(WorkOrderStatus.COMPLETED);

      expect(workOrder.finishedAt).toBeInstanceOf(Date);
    });

    it('should set deliveredAt when transitioning to DELIVERED (updateTimestampsForStatus)', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.COMPLETED });
      workOrder.changeStatus(WorkOrderStatus.DELIVERED);

      expect(workOrder.deliveredAt).toBeInstanceOf(Date);
    });

    it('should allow REJECTED -> AWAITING_APPROVAL', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });
      workOrder.changeStatus(WorkOrderStatus.REJECTED);
      workOrder.changeStatus(WorkOrderStatus.AWAITING_APPROVAL);

      expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);
    });

    it('should throw on REJECTED -> IN_DIAGNOSIS', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });
      workOrder.changeStatus(WorkOrderStatus.REJECTED);

      expect(() => workOrder.changeStatus(WorkOrderStatus.IN_DIAGNOSIS)).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should fall back to empty transitions when current status is not in the map', () => {
      const workOrder = createMockWorkOrder({
        status: 'UNKNOWN_STATUS' as unknown as WorkOrderStatus,
      });

      expect(() => workOrder.changeStatus(WorkOrderStatus.IN_DIAGNOSIS)).toThrow(
        BusinessRuleViolationException,
      );
    });
  });

  describe('isTerminalStatus()', () => {
    it('should report a status with outgoing transitions as not terminal', () => {
      expect(WorkOrder.isTerminalStatus(WorkOrderStatus.RECEIVED)).toBe(false);
    });

    it('should report a status with no outgoing transition as terminal', () => {
      expect(WorkOrder.isTerminalStatus(WorkOrderStatus.DELIVERED)).toBe(true);
    });

    it('should treat a status absent from the map as terminal', () => {
      expect(WorkOrder.isTerminalStatus('UNKNOWN_STATUS' as unknown as WorkOrderStatus)).toBe(true);
    });
  });

  describe('ensureCanCreateQuote()', () => {
    it('should not throw for IN_DIAGNOSIS status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_DIAGNOSIS });
      expect(() => workOrder.ensureCanCreateQuote()).not.toThrow();
    });

    it('should not throw for AWAITING_APPROVAL status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });
      expect(() => workOrder.ensureCanCreateQuote()).not.toThrow();
    });

    it('should not throw for REJECTED status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.REJECTED });
      expect(() => workOrder.ensureCanCreateQuote()).not.toThrow();
    });

    it('should throw for RECEIVED status', () => {
      const workOrder = WorkOrder.create(baseProps);
      expect(() => workOrder.ensureCanCreateQuote()).toThrow(BusinessRuleViolationException);
    });
  });

  describe('ensureCanApproveQuote()', () => {
    it('should allow quote approval in AWAITING_APPROVAL', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });

      expect(() => workOrder.ensureCanApproveQuote()).not.toThrow();
    });

    it.each([WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.APPROVED, WorkOrderStatus.REJECTED])(
      'should refuse quote approval outside AWAITING_APPROVAL (%s)',
      (status) => {
        const workOrder = createMockWorkOrder({ status });

        expect(() => workOrder.ensureCanApproveQuote()).toThrow(
          new BusinessRuleViolationException(
            `Orçamento só pode ser aprovado com a Ordem de Serviço aguardando aprovação. Status atual: "${status}"`,
          ),
        );
      },
    );
  });

  describe('ensureCanSubmitQuote()', () => {
    it('should not throw for IN_DIAGNOSIS status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_DIAGNOSIS });
      expect(() => workOrder.ensureCanSubmitQuote()).not.toThrow();
    });

    it('should not throw for REJECTED status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.REJECTED });
      expect(() => workOrder.ensureCanSubmitQuote()).not.toThrow();
    });

    it('should throw for RECEIVED status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
      expect(() => workOrder.ensureCanSubmitQuote()).toThrow(BusinessRuleViolationException);
    });

    it('should not throw for AWAITING_APPROVAL status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });
      expect(() => workOrder.ensureCanSubmitQuote()).not.toThrow();
    });

    it('should throw for APPROVED status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.APPROVED });
      expect(() => workOrder.ensureCanSubmitQuote()).toThrow(BusinessRuleViolationException);
    });

    it('should throw for IN_PROGRESS status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_PROGRESS });
      expect(() => workOrder.ensureCanSubmitQuote()).toThrow(BusinessRuleViolationException);
    });

    it('should throw for COMPLETED status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.COMPLETED });
      expect(() => workOrder.ensureCanSubmitQuote()).toThrow(BusinessRuleViolationException);
    });

    it('should throw for DELIVERED status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.DELIVERED });
      expect(() => workOrder.ensureCanSubmitQuote()).toThrow(BusinessRuleViolationException);
    });

    it('should throw for CANCELLED status', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.CANCELLED });
      expect(() => workOrder.ensureCanSubmitQuote()).toThrow(BusinessRuleViolationException);
    });
  });

  describe('startServiceItem()', () => {
    it('should start service and transition WO to IN_PROGRESS', () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.PENDING,
      });
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('000001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.APPROVED,
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
        services: [woService],
      });

      workOrder.startServiceItem(serviceId);

      expect(woService.status).toBe(WorkOrderServiceStatus.IN_PROGRESS);
      expect(workOrder.status).toBe(WorkOrderStatus.IN_PROGRESS);
    });

    it('should start service without changing WO status when already IN_PROGRESS', () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.PENDING,
      });
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('000001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.IN_PROGRESS,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 0,
        approvedAt: null,
        rejectedAt: null,
        startedAt: new Date(),
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        services: [woService],
      });

      workOrder.startServiceItem(serviceId);

      expect(woService.status).toBe(WorkOrderServiceStatus.IN_PROGRESS);
      expect(workOrder.status).toBe(WorkOrderStatus.IN_PROGRESS);
    });

    it('should throw EntityNotFoundException when service not found', () => {
      const workOrder = createMockWorkOrder({ services: [] });

      expect(() => workOrder.startServiceItem(randomUUID())).toThrow(EntityNotFoundException);
    });

    it('should throw EntityNotFoundException when services is undefined', () => {
      const workOrder = WorkOrder.create(baseProps);
      // services is undefined by default after create

      expect(() => workOrder.startServiceItem(randomUUID())).toThrow(EntityNotFoundException);
    });

    it('should throw BusinessRuleViolationException when service already IN_PROGRESS', () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
      });
      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.IN_PROGRESS,
        services: [woService],
      });

      expect(() => workOrder.startServiceItem(serviceId)).toThrow(BusinessRuleViolationException);
    });
  });

  describe('completeServiceItem()', () => {
    it('should complete service and transition WO to COMPLETED when all services done', () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
      });
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('000001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.IN_PROGRESS,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 0,
        approvedAt: null,
        rejectedAt: null,
        startedAt: new Date(),
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        services: [woService],
      });

      workOrder.completeServiceItem(serviceId);

      expect(woService.status).toBe(WorkOrderServiceStatus.COMPLETED);
      expect(workOrder.status).toBe(WorkOrderStatus.COMPLETED);
    });

    it('should complete service and transition WO to COMPLETED when multiple services all done', () => {
      const serviceId = randomUUID();
      const woService1 = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
      });
      const woService2 = createMockWorkOrderService({
        serviceId: randomUUID(),
        status: WorkOrderServiceStatus.COMPLETED,
      });
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('000001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.IN_PROGRESS,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 0,
        approvedAt: null,
        rejectedAt: null,
        startedAt: new Date(),
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        services: [woService1, woService2],
      });

      workOrder.completeServiceItem(serviceId);

      expect(woService1.status).toBe(WorkOrderServiceStatus.COMPLETED);
      expect(workOrder.status).toBe(WorkOrderStatus.COMPLETED);
    });

    it('should complete service without changing WO status when other services remain', () => {
      const serviceId = randomUUID();
      const completingService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
      });
      const pendingService = createMockWorkOrderService({
        serviceId: randomUUID(),
        status: WorkOrderServiceStatus.PENDING,
      });
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('000001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.IN_PROGRESS,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 0,
        approvedAt: null,
        rejectedAt: null,
        startedAt: new Date(),
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        services: [completingService, pendingService],
      });

      workOrder.completeServiceItem(serviceId);

      expect(completingService.status).toBe(WorkOrderServiceStatus.COMPLETED);
      expect(workOrder.status).toBe(WorkOrderStatus.IN_PROGRESS);
    });

    it('should throw EntityNotFoundException when service not found', () => {
      const workOrder = createMockWorkOrder({ services: [] });

      expect(() => workOrder.completeServiceItem(randomUUID())).toThrow(EntityNotFoundException);
    });

    it('should throw EntityNotFoundException when services is undefined', () => {
      const workOrder = WorkOrder.create(baseProps);
      // services is undefined by default after create

      expect(() => workOrder.completeServiceItem(randomUUID())).toThrow(EntityNotFoundException);
    });

    it('should throw BusinessRuleViolationException when service already COMPLETED', () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.COMPLETED,
      });
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('000001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.IN_PROGRESS,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 0,
        approvedAt: null,
        rejectedAt: null,
        startedAt: new Date(),
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        services: [woService],
      });

      expect(() => workOrder.completeServiceItem(serviceId)).toThrow(
        BusinessRuleViolationException,
      );
    });
  });

  describe('applyQuoteItems()', () => {
    it('should create WO service/part items and recalculate totalAmount from item prices', () => {
      const quoteService = createMockQuoteService();
      const quotePartSupply = createMockQuotePartSupply();
      const quote = createMockQuote({ services: [quoteService], partsSupplies: [quotePartSupply] });

      const workOrder = WorkOrder.create(baseProps);
      const result = workOrder.applyQuoteItems(quote);

      expect(result.services).toHaveLength(1);
      expect(result.partSupplies).toHaveLength(1);
      expect(result.services[0].serviceId).toBe(quoteService.serviceId);
      expect(result.partSupplies[0].partSupplyId).toBe(quotePartSupply.partSupplyId);
      expect(workOrder.totalAmount).toBe(
        result.services[0].totalPrice + result.partSupplies[0].totalPrice,
      );
      expect(workOrder.services).toHaveLength(1);
      expect(workOrder.partSupplies).toHaveLength(1);
    });

    it('should handle quote with no services or parts', () => {
      const quote = createMockQuote({ services: [], partsSupplies: [] });

      const workOrder = WorkOrder.create(baseProps);
      const result = workOrder.applyQuoteItems(quote);

      expect(result.services).toHaveLength(0);
      expect(result.partSupplies).toHaveLength(0);
      expect(workOrder.totalAmount).toBe(0);
    });

    it('should treat undefined services as empty array', () => {
      const quotePartSupply = createMockQuotePartSupply();
      const quote = createMockQuote({ partsSupplies: [quotePartSupply] });

      const workOrder = WorkOrder.create(baseProps);
      const result = workOrder.applyQuoteItems(quote);

      expect(result.services).toHaveLength(0);
      expect(result.partSupplies).toHaveLength(1);
    });

    it('should treat undefined partsSupplies as empty array', () => {
      const quoteService = createMockQuoteService();
      const quote = createMockQuote({ services: [quoteService] });

      const workOrder = WorkOrder.create(baseProps);
      const result = workOrder.applyQuoteItems(quote);

      expect(result.services).toHaveLength(1);
      expect(result.partSupplies).toHaveLength(0);
    });

    it('should throw BusinessRuleViolationException when a service was already added', () => {
      const serviceId = randomUUID();
      const quoteService = createMockQuoteService({ serviceId });
      const quote = createMockQuote({ services: [quoteService], partsSupplies: [] });

      const workOrder = WorkOrder.create(baseProps);
      workOrder.applyQuoteItems(quote);

      const quote2 = createMockQuote({ services: [quoteService], partsSupplies: [] });
      expect(() => workOrder.applyQuoteItems(quote2)).toThrow(BusinessRuleViolationException);
    });

    it('should throw BusinessRuleViolationException when a part/supply was already added', () => {
      const partSupplyId = randomUUID();
      const quotePartSupply = createMockQuotePartSupply({ partSupplyId });
      const quote = createMockQuote({ services: [], partsSupplies: [quotePartSupply] });

      const workOrder = WorkOrder.create(baseProps);
      workOrder.applyQuoteItems(quote);

      const quote2 = createMockQuote({ services: [], partsSupplies: [quotePartSupply] });
      expect(() => workOrder.applyQuoteItems(quote2)).toThrow(BusinessRuleViolationException);
    });
  });
});
