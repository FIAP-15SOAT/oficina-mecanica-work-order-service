import { randomUUID } from 'node:crypto';
import { SagaFailureReason } from '../enums/saga-failure-reason.enum';
import { SagaStatus } from '../enums/saga-status.enum';
import { SagaType } from '../enums/saga-type.enum';
import { BusinessRuleViolationException } from '../exceptions/business-rule-violation.exception';

export interface CreateSagaInstanceProps {
  type: SagaType;
  correlationId: string;
  workOrderId: string;
  status: SagaStatus;
  failureReason?: SagaFailureReason | null;
}

interface SagaInstanceProps {
  id: string;
  type: SagaType;
  correlationId: string;
  workOrderId: string;
  status: SagaStatus;
  failureReason: SagaFailureReason | null;
}

export class SagaInstance {
  readonly id: string;
  readonly type: SagaType;
  readonly correlationId: string;
  readonly workOrderId: string;
  private _status: SagaStatus;
  private _failureReason: SagaFailureReason | null;

  private constructor(props: SagaInstanceProps) {
    this.id = props.id;
    this.type = props.type;
    this.correlationId = props.correlationId;
    this.workOrderId = props.workOrderId;
    this._status = props.status;
    this._failureReason = props.failureReason;
  }

  static reconstitute(props: SagaInstanceProps): SagaInstance {
    return new SagaInstance(props);
  }

  static create(props: CreateSagaInstanceProps): SagaInstance {
    return new SagaInstance({
      id: randomUUID(),
      ...props,
      failureReason: props.failureReason ?? null,
    });
  }

  complete(): void {
    this.ensureStatus(
      SagaStatus.RESERVING_STOCK,
      'Só a Saga aguardando a reserva de estoque pode ser concluída',
    );

    this._status = SagaStatus.COMPLETED;
  }

  requestCompensation(reason: SagaFailureReason): void {
    this.ensureStatus(
      SagaStatus.RESERVING_STOCK,
      'Só a Saga aguardando a reserva de estoque pode entrar em compensação',
    );

    this._status = SagaStatus.COMPENSATING;
    this._failureReason = reason;
  }

  compensate(): void {
    this.ensureStatus(SagaStatus.COMPENSATING, 'Só a Saga em compensação pode ser compensada');

    this._status = SagaStatus.COMPENSATED;
  }

  reopen(
    status: SagaStatus.RESERVING_STOCK | SagaStatus.COMPENSATING,
    failureReason: SagaFailureReason | null,
  ): void {
    if (!this.isReopenable) {
      throw new BusinessRuleViolationException(
        `Só a Saga compensada por falta de estoque pode ser reaberta. Status atual: "${this._status}"`,
      );
    }

    this._status = status;
    this._failureReason = failureReason;
  }

  private ensureStatus(expectedStatus: SagaStatus, message: string): void {
    if (this._status !== expectedStatus) {
      throw new BusinessRuleViolationException(`${message}. Status atual: "${this._status}"`);
    }
  }

  get status(): SagaStatus {
    return this._status;
  }

  get failureReason(): SagaFailureReason | null {
    return this._failureReason;
  }

  // Only a stock shortage puts the quote back to SENT, so a new approval of it is legitimate.
  get isReopenable(): boolean {
    return (
      this._status === SagaStatus.COMPENSATED &&
      this._failureReason === SagaFailureReason.INSUFFICIENT_STOCK
    );
  }
}
