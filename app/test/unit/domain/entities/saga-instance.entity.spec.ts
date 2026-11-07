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
  });

  describe('complete', () => {
    it('should complete a saga reserving stock', () => {
      const saga = createMockSagaInstance({ status: SagaStatus.RESERVING_STOCK });

      saga.complete();

      expect(saga.status).toBe(SagaStatus.COMPLETED);
    });
  });

  describe('compensate', () => {
    it('should compensate a saga reserving stock with the failure reason', () => {
      const saga = createMockSagaInstance({ status: SagaStatus.RESERVING_STOCK });

      saga.compensate(SagaFailureReason.INSUFFICIENT_STOCK);

      expect(saga.status).toBe(SagaStatus.COMPENSATED);
      expect(saga.failureReason).toBe(SagaFailureReason.INSUFFICIENT_STOCK);
    });
  });

  describe('reopenStockReservation', () => {
    it('should reopen a saga compensated for insufficient stock', () => {
      const saga = createMockSagaInstance({
        status: SagaStatus.COMPENSATED,
        failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
      });

      saga.reopenStockReservation();

      expect(saga.status).toBe(SagaStatus.RESERVING_STOCK);
      expect(saga.failureReason).toBeNull();
    });

    it('should refuse to reopen a compensated saga without the insufficient stock reason', () => {
      const saga = createMockSagaInstance({ status: SagaStatus.COMPENSATED, failureReason: null });

      expect(() => saga.reopenStockReservation()).toThrow(
        'Só a Saga compensada por falta de estoque pode ser reaberta. Status atual: "COMPENSATED"',
      );
    });
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
        'compensate',
        SagaStatus.COMPLETED,
        'Só a Saga aguardando a reserva de estoque pode ser compensada',
      ],
      [
        'compensate',
        SagaStatus.COMPENSATED,
        'Só a Saga aguardando a reserva de estoque pode ser compensada',
      ],
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
    ])('should refuse to %s a saga in %s', (action, status, message) => {
      const saga = createMockSagaInstance({ status });

      const transitions: Record<string, () => void> = {
        complete: () => saga.complete(),
        compensate: () => saga.compensate(SagaFailureReason.INSUFFICIENT_STOCK),
        reopen: () => saga.reopenStockReservation(),
      };

      expect(transitions[action]).toThrow(BusinessRuleViolationException);
      expect(transitions[action]).toThrow(`${message}. Status atual: "${status}"`);
      expect(saga.status).toBe(status);
    });
  });
});
