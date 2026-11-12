import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';

import { createMockSagaInstance } from '../../../helpers/saga-instance-mock.factory';

describe('SagaInstance', () => {
  const quoteId = '7e2a3b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c';
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
    });
  });

  describe('complete', () => {
    it('should complete a saga reserving stock', () => {
      const saga = createMockSagaInstance({ status: SagaStatus.RESERVING_STOCK });

      saga.complete();

      expect(saga.status).toBe(SagaStatus.COMPLETED);
    });
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
