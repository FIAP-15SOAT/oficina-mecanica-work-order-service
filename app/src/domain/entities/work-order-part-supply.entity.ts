import { validate as isUuid } from 'uuid';
import { DomainValidationException } from '../exceptions/domain-validation.exception';
import { LineItemPrice } from '../value-objects/line-item-price.vo';

export interface CreateWorkOrderPartSupplyProps {
  workOrderId: string;
  partSupplyId: string;
  quantity: number;
  unitPrice: number;
}

interface WorkOrderPartSupplyProps {
  workOrderId: string;
  partSupplyId: string;
  lineItem: LineItemPrice;
  createdAt: Date;
  updatedAt: Date;
}

interface ReconstitueWorkOrderPartSupplyProps {
  workOrderId: string;
  partSupplyId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  createdAt: Date;
  updatedAt: Date;
}

export class WorkOrderPartSupply {
  readonly workOrderId: string;
  readonly partSupplyId: string;
  private readonly _lineItem: LineItemPrice;
  readonly createdAt: Date;
  updatedAt: Date;

  private constructor(props: WorkOrderPartSupplyProps) {
    this.workOrderId = props.workOrderId;
    this.partSupplyId = props.partSupplyId;
    this._lineItem = props.lineItem;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static reconstitute(props: ReconstitueWorkOrderPartSupplyProps): WorkOrderPartSupply {
    return new WorkOrderPartSupply({
      workOrderId: props.workOrderId,
      partSupplyId: props.partSupplyId,
      lineItem: LineItemPrice.reconstitute(props.quantity, props.unitPrice, props.totalPrice),
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  static create(props: CreateWorkOrderPartSupplyProps): WorkOrderPartSupply {
    const now = new Date();

    WorkOrderPartSupply.validateWorkOrderId(props.workOrderId);
    WorkOrderPartSupply.validatePartSupplyId(props.partSupplyId);

    return new WorkOrderPartSupply({
      workOrderId: props.workOrderId,
      partSupplyId: props.partSupplyId,
      lineItem: LineItemPrice.create(props.quantity, props.unitPrice),
      createdAt: now,
      updatedAt: now,
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

  private static validatePartSupplyId(partSupplyId: string): void {
    if (!partSupplyId) {
      throw new DomainValidationException('ID da peça/insumo é obrigatório.');
    }

    if (!isUuid(partSupplyId)) {
      throw new DomainValidationException('ID da peça/insumo deve ser um UUID válido.');
    }
  }

  get lineItem(): LineItemPrice {
    return this._lineItem;
  }

  get quantity(): number {
    return this._lineItem.quantity;
  }

  get unitPrice(): number {
    return this._lineItem.unitPrice;
  }

  get totalPrice(): number {
    return this._lineItem.totalPrice;
  }
}
