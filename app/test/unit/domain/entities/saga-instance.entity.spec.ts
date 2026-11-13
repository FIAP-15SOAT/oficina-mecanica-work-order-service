import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';

import { createMockSagaInstance } from '../../../helpers/saga-instance-mock.factory';

describe('SagaInstance', () => {
  const quoteId = '7e2a3b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c';
  const paymentId = '8f3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
  const workOrderId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

  describe('create', () => {
    it.each([SagaStatus.RESERVING_STOCK, SagaStatus.COMPLETED])(
      'should create a saga in %s without failure reason',
      (status) => {
        const saga = SagaInstance.create({
          type: SagaType.QUOTE_APPROVAL,
          correlationId: quoteId,
          workOrderId,
          status,
        });

        expect(saga.id).toEqual(expect.any(String));
        expect(saga.type).toBe(SagaType.QUOTE_APPROVAL);
        expect(saga.correlationId).toBe(quoteId);
        expect(saga.workOrderId).toBe(workOrderId);
        expect(saga.status).toBe(status);
        expect(saga.failureReason).toBeNull();
      },
    );

    it('should create a saga compensating with the failure reason', () => {
      const saga = SagaInstance.create({
        type: SagaType.QUOTE_APPROVAL,
        correlationId: quoteId,
        workOrderId,
        status: SagaStatus.COMPENSATING,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING,
      });

      expect(saga.status).toBe(SagaStatus.COMPENSATING);
      expect(saga.failureReason).toBe(SagaFailureReason.WORK_ORDER_NOT_AWAITING);
      expect(saga.originStatus).toBeNull();
    });

    it('should create a payment saga with its origin status and timestamps', () => {
      const before = Date.now();

      const saga = SagaInstance.create({
        type: SagaType.PAYMENT,
        correlationId: paymentId,
        workOrderId,
        status: SagaStatus.AWAITING_PAYMENT,
        originStatus: WorkOrderStatus.COMPLETED,
      });

      expect(saga.type).toBe(SagaType.PAYMENT);
      expect(saga.status).toBe(SagaStatus.AWAITING_PAYMENT);
      expect(saga.originStatus).toBe(WorkOrderStatus.COMPLETED);
      expect(saga.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(saga.updatedAt).toEqual(saga.createdAt);
    });
  });

  describe('complete', () => {
    it('should complete a saga reserving stock', () => {
      const saga = createMockSagaInstance({ status: SagaStatus.RESERVING_STOCK });

      saga.complete();

      expect(saga.status).toBe(SagaStatus.COMPLETED);
    });

    it.each([SagaStatus.AWAITING_PAYMENT, SagaStatus.COMPENSATING])(
      'should complete a payment saga awaiting payment or compensating (%s)',
      (status) => {
        const saga = createMockSagaInstance({ type: SagaType.PAYMENT, status });

        saga.complete();

        expect(saga.status).toBe(SagaStatus.COMPLETED);
      },
    );

    it('should refuse completing a quote approval saga in compensation', () => {
      const saga = createMockSagaInstance({ status: SagaStatus.COMPENSATING });

      expect(() => saga.complete()).toThrow(
        'Só a Saga aguardando a reserva de estoque pode ser concluída. Status atual: "COMPENSATING"',
      );

      expect(saga.status).toBe(SagaStatus.COMPENSATING);
    });

    it.each([SagaStatus.COMPLETED, SagaStatus.COMPENSATED])(
      'should refuse completing a payment saga already settled (%s)',
      (status) => {
        const saga = createMockSagaInstance({ type: SagaType.PAYMENT, status });

        expect(() => saga.complete()).toThrow(
          `Só a Saga aguardando o pagamento ou em compensação pode ser concluída. Status atual: "${status}"`,
        );
      },
    );
  });

  describe('requestCompensation', () => {
    it('should move a saga reserving stock to COMPENSATING with the failure reason', () => {
      const saga = createMockSagaInstance({ status: SagaStatus.RESERVING_STOCK });

      saga.requestCompensation(SagaFailureReason.INSUFFICIENT_STOCK);

      expect(saga.status).toBe(SagaStatus.COMPENSATING);
      expect(saga.failureReason).toBe(SagaFailureReason.INSUFFICIENT_STOCK);
    });
  });

  describe('compensate', () => {
    it('should compensate a saga compensating and keep its failure reason', () => {
      const saga = createMockSagaInstance({
        status: SagaStatus.COMPENSATING,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING,
      });

      saga.compensate();

      expect(saga.status).toBe(SagaStatus.COMPENSATED);
      expect(saga.failureReason).toBe(SagaFailureReason.WORK_ORDER_NOT_AWAITING);
    });

    it('should compensate a payment saga awaiting payment with the given failure reason', () => {
      const saga = createMockSagaInstance({
        type: SagaType.PAYMENT,
        status: SagaStatus.AWAITING_PAYMENT,
      });

      saga.compensate(SagaFailureReason.PAYMENT_EXPIRED);

      expect(saga.status).toBe(SagaStatus.COMPENSATED);
      expect(saga.failureReason).toBe(SagaFailureReason.PAYMENT_EXPIRED);
    });

    it('should keep the compensation reason when a compensating saga is compensated', () => {
      const saga = createMockSagaInstance({
        type: SagaType.PAYMENT,
        status: SagaStatus.COMPENSATING,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_PAYABLE,
      });

      saga.compensate(SagaFailureReason.PAYMENT_CANCELLED);

      expect(saga.status).toBe(SagaStatus.COMPENSATED);
      expect(saga.failureReason).toBe(SagaFailureReason.WORK_ORDER_NOT_PAYABLE);
    });

    it.each([SagaStatus.COMPLETED, SagaStatus.COMPENSATED])(
      'should refuse compensating a payment saga already settled (%s)',
      (status) => {
        const saga = createMockSagaInstance({ type: SagaType.PAYMENT, status });

        expect(() => saga.compensate(SagaFailureReason.PAYMENT_REJECTED)).toThrow(
          `Só a Saga aguardando o pagamento ou em compensação pode ser compensada. Status atual: "${status}"`,
        );
      },
    );
  });

  describe('reopen', () => {
    it.each([
      [SagaStatus.RESERVING_STOCK, null],
      [SagaStatus.COMPENSATING, SagaFailureReason.WORK_ORDER_NOT_AWAITING],
    ] as const)(
      'should reopen a saga compensated for insufficient stock in %s',
      (status, failureReason) => {
        const saga = createMockSagaInstance({
          status: SagaStatus.COMPENSATED,
          failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
        });

        saga.reopen(status, failureReason);

        expect(saga.status).toBe(status);
        expect(saga.failureReason).toBe(failureReason);
      },
    );

    it('should refuse to reopen a saga compensated because the work order was not awaiting approval', () => {
      const saga = createMockSagaInstance({
        status: SagaStatus.COMPENSATED,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING,
      });

      expect(() => saga.reopen(SagaStatus.RESERVING_STOCK, null)).toThrow(
        'Só a Saga compensada por falta de estoque pode ser reaberta. Status atual: "COMPENSATED"',
      );

      expect(saga.failureReason).toBe(SagaFailureReason.WORK_ORDER_NOT_AWAITING);
    });
  });

  describe('isReopenable', () => {
    it.each([
      [SagaStatus.COMPENSATED, SagaFailureReason.INSUFFICIENT_STOCK, true],
      [SagaStatus.COMPENSATED, SagaFailureReason.WORK_ORDER_NOT_AWAITING, false],
      [SagaStatus.COMPENSATING, SagaFailureReason.INSUFFICIENT_STOCK, false],
      [SagaStatus.RESERVING_STOCK, null, false],
      [SagaStatus.COMPLETED, null, false],
    ])(
      'should tell whether a saga in %s with %s failure reason is reopenable',
      (status, failureReason, reopenable) => {
        const saga = createMockSagaInstance({ status, failureReason });

        expect(saga.isReopenable).toBe(reopenable);
      },
    );
  });

  describe('invalid transitions', () => {
    it.each([
      [
        'complete',
        SagaStatus.COMPLETED,
        'Só a Saga aguardando a reserva de estoque pode ser concluída',
      ],
      [
        'complete',
        SagaStatus.COMPENSATED,
        'Só a Saga aguardando a reserva de estoque pode ser concluída',
      ],
      [
        'complete',
        SagaStatus.COMPENSATING,
        'Só a Saga aguardando a reserva de estoque pode ser concluída',
      ],
      [
        'requestCompensation',
        SagaStatus.COMPLETED,
        'Só a Saga aguardando a reserva de estoque pode entrar em compensação',
      ],
      [
        'requestCompensation',
        SagaStatus.COMPENSATING,
        'Só a Saga aguardando a reserva de estoque pode entrar em compensação',
      ],
      [
        'requestCompensation',
        SagaStatus.COMPENSATED,
        'Só a Saga aguardando a reserva de estoque pode entrar em compensação',
      ],
      ['compensate', SagaStatus.RESERVING_STOCK, 'Só a Saga em compensação pode ser compensada'],
      ['compensate', SagaStatus.COMPLETED, 'Só a Saga em compensação pode ser compensada'],
      ['compensate', SagaStatus.COMPENSATED, 'Só a Saga em compensação pode ser compensada'],
      [
        'reopen',
        SagaStatus.RESERVING_STOCK,
        'Só a Saga compensada por falta de estoque pode ser reaberta',
      ],
      [
        'reopen',
        SagaStatus.COMPLETED,
        'Só a Saga compensada por falta de estoque pode ser reaberta',
      ],
      [
        'reopen',
        SagaStatus.COMPENSATING,
        'Só a Saga compensada por falta de estoque pode ser reaberta',
      ],
    ])('should refuse to %s a saga in %s', (action, status, message) => {
      const saga = createMockSagaInstance({ status });

      const transitions: Record<string, () => void> = {
        complete: () => saga.complete(),
        requestCompensation: () => saga.requestCompensation(SagaFailureReason.INSUFFICIENT_STOCK),
        compensate: () => saga.compensate(),
        reopen: () => saga.reopen(SagaStatus.RESERVING_STOCK, null),
      };

      expect(transitions[action]).toThrow(BusinessRuleViolationException);
      expect(transitions[action]).toThrow(`${message}. Status atual: "${status}"`);
      expect(saga.status).toBe(status);
    });
  });
});
