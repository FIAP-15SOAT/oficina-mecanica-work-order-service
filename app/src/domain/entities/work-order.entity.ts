import { randomUUID } from 'node:crypto';
import { validate as isUuid } from 'uuid';
import { UserRole } from '../enums/user-role.enum';
import { WorkOrderStatus } from '../enums/work-order-status.enum';
import { WorkOrderServiceStatus } from '../enums/work-order-service-status.enum';
import { DomainValidationException } from '../exceptions/domain-validation.exception';
import { BusinessRuleViolationException } from '../exceptions/business-rule-violation.exception';
import { EntityNotFoundException } from '../exceptions/entity-not-found.exception';
import { Customer } from './customer.entity';
import { Vehicle } from './vehicle.entity';
import { User } from './user.entity';
import { WorkOrderService } from './work-order-service.entity';
import { WorkOrderPartSupply } from './work-order-part-supply.entity';
import { Quote } from './quote.entity';
import { WorkOrderNumber } from '../value-objects/work-order-number.vo';

import {
  MAX_PROBLEM_DESCRIPTION_LENGTH,
  MAX_INTERNAL_NOTES_LENGTH,
} from '../constants/validation/work-order.constants';

export interface CreateWorkOrderProps {
  id?: string;
  number: string;
  customerId: string;
  vehicleId: string;
  problemDescription?: string | null;
  internalNotes?: string | null;
  mileageAtService?: number | null;
  assignedUser?: User | null;
}

export interface UpdateWorkOrderProps {
  problemDescription?: string | null;
  internalNotes?: string | null;
  mileageAtService?: number | null;
  assignedUser?: User | null;
}

export interface WorkOrderProps {
  id: string;
  number: WorkOrderNumber;
  customerId: string;
  vehicleId: string;
  assignedUserId: string | null;
  status: WorkOrderStatus;
  problemDescription: string | null;
  internalNotes: string | null;
  mileageAtService: number | null;
  totalAmount: number;
  version: number;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  services?: WorkOrderService[];
  partSupplies?: WorkOrderPartSupply[];
}

type WorkOrderTimestampField =
  | 'startedAt'
  | 'finishedAt'
  | 'deliveredAt'
  | 'rejectedAt'
  | 'approvedAt';

export class WorkOrder {
  readonly id: string;
  readonly number: WorkOrderNumber;
  readonly customerId: string;
  readonly vehicleId: string;
  assignedUserId: string | null;
  private _status: WorkOrderStatus;
  problemDescription: string | null;
  internalNotes: string | null;
  mileageAtService: number | null;
  private _totalAmount: number;
  version: number;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  deliveredAt: Date | null;
  readonly createdAt: Date;
  updatedAt: Date;

  customer?: Customer;
  vehicle?: Vehicle;
  assignedUser?: User | null;
  private _services: WorkOrderService[];
  private _partSupplies: WorkOrderPartSupply[];

  private constructor(props: WorkOrderProps) {
    this.id = props.id;
    this.number = props.number;
    this.customerId = props.customerId;
    this.vehicleId = props.vehicleId;
    this.assignedUserId = props.assignedUserId;
    this._status = props.status;
    this.problemDescription = props.problemDescription;
    this.internalNotes = props.internalNotes;
    this.mileageAtService = props.mileageAtService;
    this._totalAmount = props.totalAmount;
    this.version = props.version;
    this.approvedAt = props.approvedAt;
    this.rejectedAt = props.rejectedAt;
    this.startedAt = props.startedAt;
    this.finishedAt = props.finishedAt;
    this.deliveredAt = props.deliveredAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this._services = props.services ?? [];
    this._partSupplies = props.partSupplies ?? [];
  }

  static reconstitute(props: WorkOrderProps): WorkOrder {
    return new WorkOrder(props);
  }

  static create(props: CreateWorkOrderProps): WorkOrder {
    WorkOrder.validateCustomerId(props.customerId);
    WorkOrder.validateVehicleId(props.vehicleId);
    WorkOrder.validateMileage(props.mileageAtService ?? null);
    WorkOrder.validateProblemDescription(props.problemDescription ?? null);
    WorkOrder.validateInternalNotes(props.internalNotes ?? null);
    WorkOrder.validateAssignedUser(props.assignedUser ?? null);

    const workOrder = new WorkOrder({
      id: props.id ?? randomUUID(),
      number: WorkOrderNumber.create(props.number),
      customerId: props.customerId,
      vehicleId: props.vehicleId,
      status: WorkOrderStatus.RECEIVED,
      problemDescription: props.problemDescription?.trim() ?? null,
      internalNotes: props.internalNotes?.trim() ?? null,
      mileageAtService: props.mileageAtService ?? null,
      totalAmount: 0,
      version: 1,
      assignedUserId: props.assignedUser?.id ?? null,
      approvedAt: null,
      rejectedAt: null,
      startedAt: null,
      finishedAt: null,
      deliveredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    workOrder.assignedUser = props.assignedUser ?? null;

    return workOrder;
  }

  startServiceItem(serviceId: string): void {
    const item = this._services.find((s) => s.serviceId === serviceId);

    if (!item) {
      throw new EntityNotFoundException('Serviço da Ordem de Serviço', serviceId);
    }

    item.startService();

    if (this.status !== WorkOrderStatus.IN_PROGRESS) {
      this.changeStatus(WorkOrderStatus.IN_PROGRESS);
    }
  }

  completeServiceItem(serviceId: string): void {
    const item = this._services.find((s) => s.serviceId === serviceId);

    if (!item) {
      throw new EntityNotFoundException('Serviço da Ordem de Serviço', serviceId);
    }

    item.completeService();

    const allCompleted = this._services.every((s) => s.status === WorkOrderServiceStatus.COMPLETED);

    if (allCompleted) {
      this.changeStatus(WorkOrderStatus.COMPLETED);
    }
  }

  applyQuoteItems(quote: Quote): {
    services: WorkOrderService[];
    partSupplies: WorkOrderPartSupply[];
  } {
    const existingServiceIds = new Set(this._services.map((s) => s.serviceId));
    const existingPartSupplyIds = new Set(this._partSupplies.map((p) => p.partSupplyId));

    const duplicateService = quote.services.find((s) => existingServiceIds.has(s.serviceId));
    const duplicatePart = quote.partsSupplies.find((p) =>
      existingPartSupplyIds.has(p.partSupplyId),
    );

    if (duplicateService) {
      throw new BusinessRuleViolationException(
        `Serviço já adicionado à ordem de serviço: ${duplicateService.serviceId}.`,
      );
    }

    if (duplicatePart) {
      throw new BusinessRuleViolationException(
        `Peça/insumo já adicionado à ordem de serviço: ${duplicatePart.partSupplyId}.`,
      );
    }

    const services = quote.services.map((s) =>
      WorkOrderService.create({
        workOrderId: this.id,
        serviceId: s.serviceId,
        quantity: s.quantity,
        unitPrice: s.unitPrice,
      }),
    );

    const partSupplies = quote.partsSupplies.map((p) =>
      WorkOrderPartSupply.create({
        workOrderId: this.id,
        partSupplyId: p.partSupplyId,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
      }),
    );

    this._services = [...this._services, ...services];
    this._partSupplies = [...this._partSupplies, ...partSupplies];

    this.recalculateTotalAmount();

    this.updatedAt = new Date();

    return { services, partSupplies };
  }

  private recalculateTotalAmount(): void {
    const servicesTotal = this._services.reduce((sum, s) => sum + s.totalPrice, 0);
    const partsTotal = this._partSupplies.reduce((sum, p) => sum + p.totalPrice, 0);

    this._totalAmount = servicesTotal + partsTotal;
  }

  ensureCanCreateQuote(): void {
    const allowedStatuses = [
      WorkOrderStatus.IN_DIAGNOSIS,
      WorkOrderStatus.AWAITING_APPROVAL,
      WorkOrderStatus.REJECTED,
    ];

    if (!allowedStatuses.includes(this.status)) {
      throw new BusinessRuleViolationException(
        `Orçamento só pode ser criado quando a Ordem de Serviço está nos status permitidos. Status atual: "${this.status}".`,
      );
    }
  }

  ensureAwaitingQuoteDecision(): void {
    if (this.status !== WorkOrderStatus.AWAITING_APPROVAL) {
      throw new BusinessRuleViolationException(
        `Orçamento só pode ser decidido com a Ordem de Serviço aguardando aprovação. Status atual: "${this.status}"`,
      );
    }
  }

  ensureCanSubmitQuote(): void {
    const allowedStatuses = [
      WorkOrderStatus.IN_DIAGNOSIS,
      WorkOrderStatus.AWAITING_APPROVAL,
      WorkOrderStatus.REJECTED,
    ];

    if (!allowedStatuses.includes(this.status)) {
      throw new BusinessRuleViolationException(
        `Orçamento só pode ser enviado após o diagnóstico da Ordem de Serviço. Status atual: "${this.status}".`,
      );
    }
  }

  update(props: UpdateWorkOrderProps): void {
    if (this.status !== WorkOrderStatus.RECEIVED && this.status !== WorkOrderStatus.IN_DIAGNOSIS) {
      throw new BusinessRuleViolationException(
        'Apenas ordens de serviço nos status RECEIVED ou IN_DIAGNOSIS podem ser atualizadas.',
      );
    }

    const nextProblemDescription =
      props.problemDescription === undefined
        ? this.problemDescription
        : (props.problemDescription?.trim() ?? null);
    const nextInternalNotes =
      props.internalNotes === undefined
        ? this.internalNotes
        : (props.internalNotes?.trim() ?? null);
    const nextMileageAtService =
      props.mileageAtService === undefined ? this.mileageAtService : props.mileageAtService;
    const nextAssignedUser =
      props.assignedUser === undefined ? (this.assignedUser ?? null) : (props.assignedUser ?? null);
    const nextAssignedUserId =
      props.assignedUser === undefined ? this.assignedUserId : (props.assignedUser?.id ?? null);

    WorkOrder.validateMileage(nextMileageAtService);
    WorkOrder.validateProblemDescription(nextProblemDescription);
    WorkOrder.validateInternalNotes(nextInternalNotes);
    WorkOrder.validateAssignedUser(nextAssignedUser);

    this.problemDescription = nextProblemDescription;
    this.internalNotes = nextInternalNotes;
    this.mileageAtService = nextMileageAtService;
    this.assignedUser = nextAssignedUser;
    this.assignedUserId = nextAssignedUserId;

    this.updatedAt = new Date();
  }

  changeStatus(newStatus: WorkOrderStatus, notes?: string | null): void {
    this.validateStatusTransition(newStatus, notes);
    this.updateTimestampsForStatus(newStatus);
    this._status = newStatus;
    this.updatedAt = new Date();
  }

  private static readonly STATUS_TRANSITION_MAP: Record<WorkOrderStatus, WorkOrderStatus[]> = {
    [WorkOrderStatus.RECEIVED]: [WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.CANCELLED],
    [WorkOrderStatus.IN_DIAGNOSIS]: [WorkOrderStatus.AWAITING_APPROVAL, WorkOrderStatus.CANCELLED],
    [WorkOrderStatus.AWAITING_APPROVAL]: [
      WorkOrderStatus.APPROVED,
      WorkOrderStatus.REJECTED,
      WorkOrderStatus.CANCELLED,
    ],
    [WorkOrderStatus.REJECTED]: [WorkOrderStatus.AWAITING_APPROVAL],
    [WorkOrderStatus.APPROVED]: [WorkOrderStatus.IN_PROGRESS],
    [WorkOrderStatus.IN_PROGRESS]: [WorkOrderStatus.COMPLETED],
    [WorkOrderStatus.COMPLETED]: [WorkOrderStatus.DELIVERED],
    [WorkOrderStatus.DELIVERED]: [],
    [WorkOrderStatus.CANCELLED]: [],
  };

  static isTerminalStatus(status: WorkOrderStatus): boolean {
    return (WorkOrder.STATUS_TRANSITION_MAP[status] ?? []).length === 0;
  }

  private validateStatusTransition(newStatus: WorkOrderStatus, notes?: string | null): void {
    if (this.status === newStatus) {
      throw new BusinessRuleViolationException(
        `A ordem de serviço já está no status ${newStatus}.`,
      );
    }

    const allowedTransitions = WorkOrder.STATUS_TRANSITION_MAP[this.status] || [];

    if (!allowedTransitions.includes(newStatus)) {
      throw new BusinessRuleViolationException(
        `Transição de status não permitida: de ${this.status} para ${newStatus}.`,
      );
    }

    if (newStatus === WorkOrderStatus.CANCELLED && !notes) {
      throw new BusinessRuleViolationException(
        'Notas são obrigatórias para cancelar uma ordem de serviço.',
      );
    }
  }

  private updateTimestampsForStatus(newStatus: WorkOrderStatus): void {
    const now = new Date();

    const statusTimestampMap: Partial<Record<WorkOrderStatus, WorkOrderTimestampField>> = {
      [WorkOrderStatus.IN_PROGRESS]: 'startedAt',
      [WorkOrderStatus.COMPLETED]: 'finishedAt',
      [WorkOrderStatus.DELIVERED]: 'deliveredAt',
      [WorkOrderStatus.REJECTED]: 'rejectedAt',
      [WorkOrderStatus.APPROVED]: 'approvedAt',
    };

    const field = statusTimestampMap[newStatus];

    if (field) {
      this[field] = now;
    }
  }

  private static validateCustomerId(customerId: string): void {
    if (!customerId) {
      throw new DomainValidationException('ID do cliente é obrigatório.');
    }

    if (!isUuid(customerId)) {
      throw new DomainValidationException('ID do cliente deve ser um UUID válido.');
    }
  }

  private static validateVehicleId(vehicleId: string): void {
    if (!vehicleId) {
      throw new DomainValidationException('ID do veículo é obrigatório.');
    }

    if (!isUuid(vehicleId)) {
      throw new DomainValidationException('ID do veículo deve ser um UUID válido.');
    }
  }

  private static validateMileage(mileageAtService: number | null): void {
    if (mileageAtService !== undefined && mileageAtService !== null && mileageAtService < 0) {
      throw new DomainValidationException('Quilometragem não pode ser negativa.');
    }
  }

  private static validateProblemDescription(problemDescription: string | null): void {
    if (!problemDescription) {
      return;
    }

    const trimmed = problemDescription.trim();

    if (trimmed.length > MAX_PROBLEM_DESCRIPTION_LENGTH) {
      throw new DomainValidationException(
        `Descrição do problema deve ter no máximo ${MAX_PROBLEM_DESCRIPTION_LENGTH} caracteres.`,
      );
    }
  }

  private static validateInternalNotes(internalNotes: string | null): void {
    if (!internalNotes) {
      return;
    }

    const trimmed = internalNotes.trim();

    if (trimmed.length > MAX_INTERNAL_NOTES_LENGTH) {
      throw new DomainValidationException(
        `Notas internas devem ter no máximo ${MAX_INTERNAL_NOTES_LENGTH} caracteres.`,
      );
    }
  }

  static validateAssignedUser(assignedUser: User | null): void {
    if (assignedUser) {
      if (assignedUser.role !== UserRole.MECHANIC || !assignedUser.isActive) {
        throw new BusinessRuleViolationException(
          'Apenas mecânicos ativos podem ser atribuídos a uma ordem de serviço',
        );
      }
    }
  }

  get status(): WorkOrderStatus {
    return this._status;
  }

  get totalAmount(): number {
    return this._totalAmount;
  }

  get services(): WorkOrderService[] {
    return this._services;
  }

  get partSupplies(): WorkOrderPartSupply[] {
    return this._partSupplies;
  }
}
