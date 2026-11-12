import { randomUUID } from 'node:crypto';

import { WorkOrder } from '@domain/entities/work-order.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { Customer } from '@domain/entities/customer.entity';
import { Vehicle } from '@domain/entities/vehicle.entity';
import { User } from '@domain/entities/user.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IVehicleRepository } from '@domain/interfaces/repositories/vehicle.repository.interface';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { BUSINESS_METRICS } from '@application/metrics/business-metric.catalog';
import { CreateWorkOrderDto } from '@application/ports/input/work-order/dto/create-work-order.dto';

import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';

interface WorkOrderParticipants {
  customer: Customer;
  vehicle: Vehicle;
  assignedUser: User | null;
}

export class CreateWorkOrderUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly customerRepository: ICustomerRepository,
    private readonly vehicleRepository: IVehicleRepository,
    private readonly userRepository: IUserRepository,
    private readonly billingQuotesGateway: IBillingQuotesGateway,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
  ) {}

  async execute(dto: CreateWorkOrderDto): Promise<WorkOrder> {
    const participants = await this.loadParticipants(dto);
    const workOrderId = randomUUID();
    const services = dto.services ?? [];
    const partsSupplies = dto.partsSupplies ?? [];

    // The Billing validates and prices the items before any number is taken from the sequence.
    const initialQuote =
      services.length > 0 || partsSupplies.length > 0
        ? await this.billingQuotesGateway.createInitialQuote({
            workOrderId,
            services,
            partsSupplies,
          })
        : null;

    let workOrder: WorkOrder;

    try {
      workOrder = await this.openWorkOrder(workOrderId, dto, participants.assignedUser);
    } catch (error) {
      if (initialQuote) {
        await this.deleteInitialQuote(initialQuote.id, workOrderId);
      }

      throw error;
    }

    workOrder.customer = participants.customer;
    workOrder.vehicle = participants.vehicle;
    workOrder.assignedUser = participants.assignedUser;

    this.metrics.increment(BUSINESS_METRICS.WORK_ORDER_CREATED, {});

    return workOrder;
  }

  private async loadParticipants(dto: CreateWorkOrderDto): Promise<WorkOrderParticipants> {
    const customer = await this.customerRepository.findById(dto.customerId);

    if (!customer) {
      throw new ResourceNotFoundException('Cliente', dto.customerId);
    }

    if (!customer.isActive) {
      throw new BusinessRuleViolationException(
        'Não é possível abrir ordem de serviço para um cliente inativo.',
      );
    }

    const vehicle = await this.vehicleRepository.findById(dto.vehicleId);

    if (!vehicle) {
      throw new ResourceNotFoundException('Veículo', dto.vehicleId);
    }

    if (vehicle.customerId !== dto.customerId) {
      throw new BusinessRuleViolationException(
        'O veículo informado não pertence ao cliente informado.',
      );
    }

    let assignedUser: User | null = null;

    if (dto.assignedUserId) {
      assignedUser = await this.userRepository.findById(dto.assignedUserId);

      if (!assignedUser) {
        throw new ResourceNotFoundException('Usuário', dto.assignedUserId);
      }

      WorkOrder.validateAssignedUser(assignedUser);
    }

    return { customer, vehicle, assignedUser };
  }

  private openWorkOrder(
    id: string,
    dto: CreateWorkOrderDto,
    assignedUser: User | null,
  ): Promise<WorkOrder> {
    return this.unitOfWork.executeTransaction(async (repos) => {
      const number = await repos.workOrder.generateNextNumber();

      const saved = await repos.workOrder.create(
        WorkOrder.create({
          id,
          customerId: dto.customerId,
          vehicleId: dto.vehicleId,
          assignedUser,
          problemDescription: dto.problemDescription,
          internalNotes: dto.internalNotes,
          mileageAtService: dto.mileageAtService,
          number,
        }),
      );

      await repos.statusHistory.create(
        StatusHistory.create({
          workOrderId: saved.id,
          changedById: dto.userId,
          newStatus: WorkOrderStatus.RECEIVED,
          previousStatus: null,
          notes: 'Ordem de serviço criada',
        }),
      );

      return saved;
    });
  }

  private async deleteInitialQuote(quoteId: string, workOrderId: string): Promise<void> {
    try {
      await this.billingQuotesGateway.deleteQuote(quoteId);
    } catch {
      // The write error is what the caller must see; the orphan quote only reaches the log.
      this.logger.event(BUSINESS_EVENTS.WORK_ORDER_OPENING_COMPENSATION_FAILED, {
        quoteId,
        workOrderId,
      });
    }
  }
}
