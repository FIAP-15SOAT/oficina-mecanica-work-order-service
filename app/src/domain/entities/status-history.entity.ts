import { validate as isUuid } from 'uuid';
import { randomUUID } from 'node:crypto';
import { WorkOrderStatus } from '../enums/work-order-status.enum';
import { DomainValidationException } from '../exceptions/domain-validation.exception';

import { MAX_STATUS_NOTES_LENGTH as MAX_NOTES_LENGTH } from '../constants/validation/work-order.constants';

export interface CreateStatusHistoryProps {
  workOrderId: string;
  changedById?: string | null;
  previousStatus?: WorkOrderStatus | null;
  newStatus: WorkOrderStatus;
  notes?: string | null;
}

interface StatusHistoryProps {
  id: string;
  workOrderId: string;
  changedById: string | null;
  previousStatus: WorkOrderStatus | null;
  newStatus: WorkOrderStatus;
  notes: string | null;
  createdAt: Date;
}

export class StatusHistory {
  readonly id: string;
  readonly workOrderId: string;
  readonly changedById: string | null;
  readonly previousStatus: WorkOrderStatus | null;
  readonly newStatus: WorkOrderStatus;
  readonly notes: string | null;
  readonly createdAt: Date;

  private constructor(props: StatusHistoryProps) {
    this.id = props.id;
    this.workOrderId = props.workOrderId;
    this.changedById = props.changedById;
    this.previousStatus = props.previousStatus;
    this.newStatus = props.newStatus;
    this.notes = props.notes;
    this.createdAt = props.createdAt;
  }

  static reconstitute(props: StatusHistoryProps): StatusHistory {
    return new StatusHistory(props);
  }

  static create(props: CreateStatusHistoryProps): StatusHistory {
    const workOrderId = props.workOrderId;
    const changedById = props.changedById ?? null;
    const newStatus = props.newStatus;
    const notes = props.notes ?? null;

    StatusHistory.validateWorkOrderId(workOrderId);
    StatusHistory.validateChangedById(changedById);
    StatusHistory.validateNewStatus(newStatus);
    StatusHistory.validateNotes(notes);

    return new StatusHistory({
      id: randomUUID(),
      workOrderId,
      changedById,
      previousStatus: props.previousStatus ?? null,
      newStatus,
      notes,
      createdAt: new Date(),
    });
  }

  private static validateWorkOrderId(workOrderId: string): void {
    if (!workOrderId) {
      throw new DomainValidationException('ID da ordem de serviço é obrigatório.');
    }

    if (!isUuid(workOrderId)) {
      throw new DomainValidationException('ID da ordem de serviço deve ser um UUID válido.');
    }
  }

  private static validateChangedById(changedById: string | null): void {
    if (changedById !== null && changedById !== undefined && !isUuid(changedById)) {
      throw new DomainValidationException('ID do usuário deve ser um UUID válido.');
    }
  }

  private static validateNewStatus(newStatus: WorkOrderStatus): void {
    if (!newStatus) {
      throw new DomainValidationException('Novo status é obrigatório.');
    }
  }

  private static validateNotes(notes: string | null): void {
    if (notes !== null && notes !== undefined && notes.length > MAX_NOTES_LENGTH) {
      throw new DomainValidationException(
        `Notas devem ter no máximo ${MAX_NOTES_LENGTH} caracteres.`,
      );
    }
  }
}
