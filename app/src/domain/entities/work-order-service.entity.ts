import { validate as isUuid } from 'uuid';
import { WorkOrderServiceStatus } from '../enums/work-order-service-status.enum';
import { DomainValidationException } from '../exceptions/domain-validation.exception';
import { BusinessRuleViolationException } from '../exceptions/business-rule-violation.exception';
import { LineItemPrice } from '../value-objects/line-item-price.vo';

export interface CreateWorkOrderServiceProps {
  workOrderId: string;
  serviceId: string;
  quantity: number;
  unitPrice: number;
}

interface WorkOrderServiceProps {
  workOrderId: string;
  serviceId: string;
  lineItem: LineItemPrice;
  status: WorkOrderServiceStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ReconstitueWorkOrderServiceProps {
  workOrderId: string;
  serviceId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  status: WorkOrderServiceStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class WorkOrderService {
  readonly workOrderId: string;
  readonly serviceId: string;
  private readonly _lineItem: LineItemPrice;
  status: WorkOrderServiceStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  readonly createdAt: Date;
  updatedAt: Date;

  private constructor(props: WorkOrderServiceProps) {
    this.workOrderId = props.workOrderId;
    this.serviceId = props.serviceId;
    this._lineItem = props.lineItem;
    this.status = props.status;
    this.startedAt = props.startedAt;
    this.finishedAt = props.finishedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static reconstitute(props: ReconstitueWorkOrderServiceProps): WorkOrderService {
    return new WorkOrderService({
      workOrderId: props.workOrderId,
      serviceId: props.serviceId,
      lineItem: LineItemPrice.reconstitute(props.quantity, props.unitPrice, props.totalPrice),
      status: props.status,
      startedAt: props.startedAt,
      finishedAt: props.finishedAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  static create(props: CreateWorkOrderServiceProps): WorkOrderService {
    const now = new Date();

    WorkOrderService.validateWorkOrderId(props.workOrderId);
    WorkOrderService.validateServiceId(props.serviceId);

    const lineItem = LineItemPrice.create(props.quantity, props.unitPrice);

    return new WorkOrderService({
      workOrderId: props.workOrderId,
      serviceId: props.serviceId,
      lineItem,
      status: WorkOrderServiceStatus.PENDING,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  startService(): void {
    if (this.status !== WorkOrderServiceStatus.PENDING) {
      const msg =
        this.status === WorkOrderServiceStatus.IN_PROGRESS
          ? 'O serviço já está em andamento.'
          : 'Não é possível iniciar um serviço já concluído.';

      throw new BusinessRuleViolationException(msg);
    }

    const now = new Date();
    this.status = WorkOrderServiceStatus.IN_PROGRESS;
    this.startedAt = now;
    this.updatedAt = now;
  }

  completeService(): void {
    if (this.status !== WorkOrderServiceStatus.IN_PROGRESS) {
      const msg =
        this.status === WorkOrderServiceStatus.COMPLETED
          ? 'O serviço já está concluído.'
          : 'O serviço precisa estar em andamento para ser concluído.';

      throw new BusinessRuleViolationException(msg);
    }

    const now = new Date();
    this.status = WorkOrderServiceStatus.COMPLETED;
    this.finishedAt = now;
    this.updatedAt = now;
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

  private static validateWorkOrderId(workOrderId: string): void {
    if (!workOrderId) {
      throw new DomainValidationException('ID da ordem de serviço é obrigatório.');
    }

    if (!isUuid(workOrderId)) {
      throw new DomainValidationException('ID da ordem de serviço deve ser um UUID válido.');
    }
  }

  private static validateServiceId(serviceId: string): void {
    if (!serviceId) {
      throw new DomainValidationException('ID do serviço é obrigatório.');
    }

    if (!isUuid(serviceId)) {
      throw new DomainValidationException('ID do serviço deve ser um UUID válido.');
    }
  }
}
