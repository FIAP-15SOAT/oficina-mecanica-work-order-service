import { randomUUID } from 'node:crypto';
import { validate as isUuid } from 'uuid';
import { StockMovementType } from '../enums/stock-movement-type.enum';
import { DomainValidationException } from '../exceptions/domain-validation.exception';
import { PartSupply } from './part-supply.entity';
import { WorkOrder } from './work-order.entity';

/**
 * Domain entity for a stock movement.
 * Types: parts and supplies entry (ENTRY), work order exit (EXIT), adjustment (ADJUSTMENT).
 * `workOrderId` is set when the exit comes from consumption in a work order.
 */

interface StockMovementProps {
  id: string;
  partSupplyId: string;
  workOrderId?: string | null;
  type: StockMovementType;
  quantity: number;
  reason?: string | null;
  createdAt: Date;
}

export class StockMovement {
  readonly id: string;
  readonly partSupplyId: string;
  /** Id of the work order linked to the exit (set only on EXIT) */
  readonly workOrderId?: string | null;
  readonly type: StockMovementType;
  readonly quantity: number;
  readonly reason?: string | null;
  readonly createdAt: Date;

  partSupply?: PartSupply;
  workOrder?: WorkOrder | null;

  private constructor(props: StockMovementProps) {
    this.id = props.id;
    this.partSupplyId = props.partSupplyId;
    this.workOrderId = props.workOrderId;
    this.type = props.type;
    this.quantity = props.quantity;
    this.reason = props.reason;
    this.createdAt = props.createdAt;
  }

  static reconstitute(props: StockMovementProps): StockMovement {
    return new StockMovement(props);
  }

  static create(props: {
    partSupplyId: string;
    workOrderId?: string | null;
    type: StockMovementType;
    quantity: number;
    reason?: string | null;
  }): StockMovement {
    StockMovement.validatePartSupplyId(props.partSupplyId);
    StockMovement.validateWorkOrderId(props.workOrderId ?? null);
    StockMovement.validateQuantity(props.quantity);

    const partSupplyId = props.partSupplyId.trim();
    const trimmedWorkOrderId = props.workOrderId?.trim();
    const workOrderId = trimmedWorkOrderId || null;
    const trimmedReason = props.reason?.trim();

    return new StockMovement({
      id: randomUUID(),
      partSupplyId,
      workOrderId,
      type: props.type,
      quantity: props.quantity,
      reason: trimmedReason || null,
      createdAt: new Date(),
    });
  }

  private static validatePartSupplyId(partSupplyId: string): void {
    const trimmed = partSupplyId?.trim();

    if (!trimmed) {
      throw new DomainValidationException('ID da peça/insumo é obrigatório.');
    }

    if (!isUuid(trimmed)) {
      throw new DomainValidationException(`ID da peça/insumo inválido.`);
    }
  }

  private static validateWorkOrderId(workOrderId: string | null): void {
    const trimmed = workOrderId?.trim();

    if (trimmed && !isUuid(trimmed)) {
      throw new DomainValidationException('ID da ordem de serviço inválido.');
    }
  }

  private static validateQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new DomainValidationException('Quantidade deve ser um inteiro positivo.');
    }
  }
}
