import { randomUUID } from 'node:crypto';
import { SagaFailureReason } from '../enums/saga-failure-reason.enum';
import { SagaStatus } from '../enums/saga-status.enum';
import { SagaType } from '../enums/saga-type.enum';
import { BusinessRuleViolationException } from '../exceptions/business-rule-violation.exception';
import { PaymentOriginStatus } from './work-order.entity';

export interface CreateSagaInstanceProps {
  type: SagaType;
  correlationId: string;
  workOrderId: string;
  status: SagaStatus;
  failureReason?: SagaFailureReason | null;
  originStatus?: PaymentOriginStatus | null;
}

interface SagaInstanceProps {
  id: string;
  type: SagaType;
  correlationId: string;
  workOrderId: string;
  status: SagaStatus;
  failureReason: SagaFailureReason | null;
  originStatus: PaymentOriginStatus | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SagaInstance {
  readonly id: string;
  readonly type: SagaType;
  readonly correlationId: string;
  readonly workOrderId: string;
  readonly originStatus: PaymentOriginStatus | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  private _status: SagaStatus;
  private _failureReason: SagaFailureReason | null;

  private constructor(props: SagaInstanceProps) {
    this.id = props.id;
    this.type = props.type;
    this.correlationId = props.correlationId;
    this.workOrderId = props.workOrderId;
    this._status = props.status;
    this._failureReason = props.failureReason;
    this.originStatus = props.originStatus;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static reconstitute(props: SagaInstanceProps): SagaInstance {
    return new SagaInstance(props);
  }

  static create(props: CreateSagaInstanceProps): SagaInstance {
    const now = new Date();

    return new SagaInstance({
      id: randomUUID(),
      ...props,
      failureReason: props.failureReason ?? null,
      originStatus: props.originStatus ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  complete(): void {
    if (this.type === SagaType.PAYMENT) {
      this.ensureStatus(
        [SagaStatus.AWAITING_PAYMENT, SagaStatus.COMPENSATING],
        'Só a Saga aguardando o pagamento ou em compensação pode ser concluída',
      );
    } else {
      this.ensureStatus(
        [SagaStatus.RESERVING_STOCK],
        'Só a Saga aguardando a reserva de estoque pode ser concluída',
      );
    }

    this._status = SagaStatus.COMPLETED;
  }

  requestCompensation(reason: SagaFailureReason): void {
    this.ensureStatus(
      [SagaStatus.RESERVING_STOCK],
      'Só a Saga aguardando a reserva de estoque pode entrar em compensação',
    );

    this._status = SagaStatus.COMPENSATING;
    this._failureReason = reason;
  }

  compensate(failureReason: SagaFailureReason | null = null): void {
    if (this.type === SagaType.PAYMENT) {
      this.ensureStatus(
        [SagaStatus.AWAITING_PAYMENT, SagaStatus.COMPENSATING],
        'Só a Saga aguardando o pagamento ou em compensação pode ser compensada',
      );
    } else {
      this.ensureStatus([SagaStatus.COMPENSATING], 'Só a Saga em compensação pode ser compensada');
    }

    this._status = SagaStatus.COMPENSATED;
    // A saga already compensating keeps the reason that started the compensation.
    this._failureReason ??= failureReason;
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

  private ensureStatus(expectedStatuses: SagaStatus[], message: string): void {
    if (!expectedStatuses.includes(this._status)) {
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
