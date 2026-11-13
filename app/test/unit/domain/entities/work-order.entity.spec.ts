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

  describe('canChangeStatusTo()', () => {
    it.each([
      [WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.AWAITING_APPROVAL, true],
      [WorkOrderStatus.AWAITING_APPROVAL, WorkOrderStatus.REJECTED, true],
      [WorkOrderStatus.CANCELLED, WorkOrderStatus.AWAITING_APPROVAL, false],
      [WorkOrderStatus.AWAITING_APPROVAL, WorkOrderStatus.AWAITING_APPROVAL, false],
    ])('should tell whether a work order in %s can change to %s', (status, newStatus, expected) => {
      const workOrder = createMockWorkOrder({ status });

      expect(workOrder.canChangeStatusTo(newStatus)).toBe(expected);
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

  describe('holdForPayment()', () => {
    it('should hold an approved work order for payment without touching approvedAt', () => {
      const approvedAt = new Date('2026-11-01T10:00:00.000Z');
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.APPROVED, approvedAt });

      workOrder.holdForPayment();

      expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_PAYMENT);
      expect(workOrder.approvedAt).toBe(approvedAt);
    });

    it('should hold a completed work order for payment without touching finishedAt', () => {
      const finishedAt = new Date('2026-11-02T10:00:00.000Z');
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.COMPLETED, finishedAt });

      workOrder.holdForPayment();

      expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_PAYMENT);
      expect(workOrder.finishedAt).toBe(finishedAt);
    });

    it.each([
      WorkOrderStatus.RECEIVED,
      WorkOrderStatus.IN_PROGRESS,
      WorkOrderStatus.AWAITING_PAYMENT,
      WorkOrderStatus.DELIVERED,
    ])('should refuse to hold a work order outside APPROVED and COMPLETED (%s)', (status) => {
      const workOrder = createMockWorkOrder({ status });

      expect(() => workOrder.holdForPayment()).toThrow(
        new BusinessRuleViolationException(
          `Só ordem de serviço aprovada ou concluída pode aguardar pagamento. Status atual: "${status}"`,
        ),
      );

      expect(workOrder.status).toBe(status);
    });
  });

  describe('releasePaymentHold()', () => {
    it.each([
      [WorkOrderStatus.APPROVED, 'approvedAt'],
      [WorkOrderStatus.COMPLETED, 'finishedAt'],
    ] as const)(
      'should release the payment hold back to the origin status without touching its timestamps (%s)',
      (origin, timestampField) => {
        const timestamp = new Date('2026-11-01T10:00:00.000Z');
        const workOrder = createMockWorkOrder({
          status: WorkOrderStatus.AWAITING_PAYMENT,
          [timestampField]: timestamp,
        });

        workOrder.releasePaymentHold(origin);

        expect(workOrder.status).toBe(origin);
        expect(workOrder[timestampField]).toBe(timestamp);
      },
    );

    it('should refuse to release a work order not awaiting payment', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_PROGRESS });

      expect(() => workOrder.releasePaymentHold(WorkOrderStatus.APPROVED)).toThrow(
        new BusinessRuleViolationException(
          'Só a ordem de serviço aguardando pagamento volta ao status de origem. Status atual: "IN_PROGRESS"',
        ),
      );

      expect(workOrder.status).toBe(WorkOrderStatus.IN_PROGRESS);
    });
  });

  describe('awaiting payment', () => {
    const awaitingPaymentMessage =
      'Ordem de serviço aguardando pagamento: execução, entrega e cancelamento voltam a valer quando a cobrança for paga, expirar ou for cancelada';

    it.each([WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.CANCELLED, WorkOrderStatus.DELIVERED])(
      'should refuse a status change while awaiting payment (%s)',
      (newStatus) => {
        const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_PAYMENT });

        expect(() => workOrder.changeStatus(newStatus, 'notes')).toThrow(
          new BusinessRuleViolationException(awaitingPaymentMessage),
        );

        expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_PAYMENT);
      },
    );

    it('should refuse a manual change to AWAITING_PAYMENT', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.APPROVED });

      expect(() => workOrder.changeStatus(WorkOrderStatus.AWAITING_PAYMENT)).toThrow(
        new BusinessRuleViolationException(
          'Ordem de serviço só passa a aguardar pagamento quando uma cobrança é criada',
        ),
      );

      expect(workOrder.status).toBe(WorkOrderStatus.APPROVED);
    });

    it('should refuse starting a service item while awaiting payment', () => {
      const serviceId = randomUUID();
      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.AWAITING_PAYMENT,
        services: [createMockWorkOrderService({ serviceId })],
      });

      expect(() => workOrder.startServiceItem(serviceId)).toThrow(
        new BusinessRuleViolationException(awaitingPaymentMessage),
      );

      expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_PAYMENT);
    });

    it('should not treat AWAITING_PAYMENT as terminal', () => {
      expect(WorkOrder.isTerminalStatus(WorkOrderStatus.AWAITING_PAYMENT)).toBe(false);
    });
  });

  describe('ensureAwaitingQuoteDecision()', () => {
    it('should allow a quote decision in AWAITING_APPROVAL', () => {
      const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });

      expect(() => workOrder.ensureAwaitingQuoteDecision()).not.toThrow();
    });

    it.each([WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.APPROVED, WorkOrderStatus.REJECTED])(
      'should refuse a quote decision outside AWAITING_APPROVAL (%s)',
      (status) => {
        const workOrder = createMockWorkOrder({ status });

        expect(() => workOrder.ensureAwaitingQuoteDecision()).toThrow(
          new BusinessRuleViolationException(
            `Orçamento só pode ser decidido com a Ordem de Serviço aguardando aprovação. Status atual: "${status}"`,
          ),
        );
      },
    );
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

  describe('applyApprovedItems()', () => {
    it('should apply the approved items and recalculate the total', () => {
      const serviceId = randomUUID();
      const partSupplyId = randomUUID();

      const workOrder = WorkOrder.create(baseProps);

      const result = workOrder.applyApprovedItems({
        services: [{ serviceId, quantity: 2, unitPrice: 150 }],
        partsSupplies: [{ partSupplyId, quantity: 3, unitPrice: 40.5 }],
      });

      expect(result.services).toEqual([
        expect.objectContaining({
          workOrderId: workOrder.id,
          serviceId,
          quantity: 2,
          unitPrice: 150,
        }),
      ]);

      expect(result.partSupplies).toEqual([
        expect.objectContaining({
          workOrderId: workOrder.id,
          partSupplyId,
          quantity: 3,
          unitPrice: 40.5,
        }),
      ]);

      expect(workOrder.services).toEqual(result.services);
      expect(workOrder.partSupplies).toEqual(result.partSupplies);
      expect(workOrder.totalAmount).toBe(421.5);
    });

    it('should apply services only when no part was approved', () => {
      const workOrder = WorkOrder.create(baseProps);

      const result = workOrder.applyApprovedItems({
        services: [{ serviceId: randomUUID(), quantity: 1, unitPrice: 200 }],
        partsSupplies: [],
      });

      expect(result.services).toHaveLength(1);
      expect(result.partSupplies).toHaveLength(0);
      expect(workOrder.totalAmount).toBe(200);
    });

    it('should throw BusinessRuleViolationException when a service was already added', () => {
      const items = {
        services: [{ serviceId: randomUUID(), quantity: 1, unitPrice: 200 }],
        partsSupplies: [],
      };

      const workOrder = WorkOrder.create(baseProps);

      workOrder.applyApprovedItems(items);

      expect(() => workOrder.applyApprovedItems(items)).toThrow(BusinessRuleViolationException);
    });

    it('should throw BusinessRuleViolationException when a part/supply was already added', () => {
      const items = {
        services: [],
        partsSupplies: [{ partSupplyId: randomUUID(), quantity: 1, unitPrice: 30 }],
      };

      const workOrder = WorkOrder.create(baseProps);

      workOrder.applyApprovedItems(items);

      expect(() => workOrder.applyApprovedItems(items)).toThrow(BusinessRuleViolationException);
    });
  });
});
