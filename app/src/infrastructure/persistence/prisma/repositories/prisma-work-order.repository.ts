import { Injectable } from '@nestjs/common';
import { Prisma } from '@generated/client';

import { PrismaService } from '../prisma.service';

import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { ConcurrencyException } from '@infrastructure/exceptions/concurrency.exception';

import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderService } from '@domain/entities/work-order-service.entity';
import { WorkOrderPartSupply } from '@domain/entities/work-order-part-supply.entity';
import {
  IWorkOrderRepository,
  WorkOrderFilters,
} from '@domain/interfaces/repositories/work-order.repository.interface';
import {
  PaginatedRepositoryResult,
  PaginationInput,
} from '@domain/interfaces/common/pagination.interface';
import { SortCriterion } from '@domain/interfaces/common/sort-criterion';

import { WorkOrderMapper } from '@infrastructure/persistence/prisma/mappers/work-order.mapper';
import { paginate } from '@infrastructure/persistence/prisma/helpers/prisma-paginate.helper';

const WORK_ORDER_LIST_INCLUDE = {
  customer: true,
  vehicle: true,
  assignedUser: true,
} as const;

const WORK_ORDER_DETAIL_INCLUDE = {
  customer: true,
  vehicle: true,
  assignedUser: true,
  services: { include: { service: true } },
  partSupplies: { include: { partSupply: true } },
} as const;

@Injectable()
export class PrismaWorkOrderRepository implements IWorkOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(workOrder: WorkOrder): Promise<WorkOrder> {
    const record = await this.prisma.workOrder.create({
      data: {
        id: workOrder.id,
        number: workOrder.number.toString(),
        customerId: workOrder.customerId,
        vehicleId: workOrder.vehicleId,
        assignedUserId: workOrder.assignedUserId,
        status: workOrder.status,
        problemDescription: workOrder.problemDescription,
        internalNotes: workOrder.internalNotes,
        mileageAtService: workOrder.mileageAtService,
        totalAmount: workOrder.totalAmount,
        approvedAt: workOrder.approvedAt,
        rejectedAt: workOrder.rejectedAt,
        startedAt: workOrder.startedAt,
        finishedAt: workOrder.finishedAt,
        deliveredAt: workOrder.deliveredAt,
      },
      include: WORK_ORDER_DETAIL_INCLUDE,
    });

    return WorkOrderMapper.toDomain(record);
  }

  async findById(id: string): Promise<WorkOrder | null> {
    const record = await this.prisma.workOrder.findUnique({
      where: { id },
      include: WORK_ORDER_LIST_INCLUDE,
    });

    return record ? WorkOrderMapper.toDomain(record) : null;
  }

  async findByIdWithDetails(id: string): Promise<WorkOrder | null> {
    const record = await this.prisma.workOrder.findUnique({
      where: { id },
      include: WORK_ORDER_DETAIL_INCLUDE,
    });
    return record ? WorkOrderMapper.toDomain(record) : null;
  }

  async findAllPaginated(
    pagination: PaginationInput,
    filters: WorkOrderFilters,
    sort?: SortCriterion[],
  ): Promise<PaginatedRepositoryResult<WorkOrder>> {
    const { number, customerId, customerIdIn, vehicleId, assignedUserId, status, statusNotIn } =
      filters;

    const where: Prisma.WorkOrderWhereInput = {};
    if (number) where.number = { contains: number.trim(), mode: 'insensitive' };
    if (customerId) where.customerId = customerId;
    if (customerIdIn !== undefined) where.customerId = { in: customerIdIn };
    if (vehicleId) where.vehicleId = vehicleId;
    if (assignedUserId) where.assignedUserId = assignedUserId;
    if (status) where.status = status;
    else if (statusNotIn?.length) where.status = { notIn: statusNotIn };

    const orderBy: Prisma.WorkOrderOrderByWithRelationInput[] = (sort ?? []).map((criterion) => {
      if (criterion.field === 'status') {
        return { statusInfo: { priority: criterion.direction } };
      }

      return { [criterion.field]: criterion.direction };
    });

    const result = await paginate(
      this.prisma.workOrder,
      { where, orderBy, include: WORK_ORDER_LIST_INCLUDE },
      pagination,
    );

    return {
      items: result.items.map((item) => WorkOrderMapper.toDomain(item)),
      total: result.total,
    };
  }

  async update(workOrder: WorkOrder): Promise<WorkOrder> {
    try {
      const record = await this.prisma.workOrder.update({
        where: { id: workOrder.id, version: workOrder.version },
        data: {
          assignedUserId: workOrder.assignedUserId,
          status: workOrder.status,
          problemDescription: workOrder.problemDescription,
          internalNotes: workOrder.internalNotes,
          mileageAtService: workOrder.mileageAtService,
          totalAmount: workOrder.totalAmount,
          approvedAt: workOrder.approvedAt,
          rejectedAt: workOrder.rejectedAt,
          startedAt: workOrder.startedAt,
          finishedAt: workOrder.finishedAt,
          deliveredAt: workOrder.deliveredAt,
          updatedAt: workOrder.updatedAt,
          version: { increment: 1 },
        },
        include: WORK_ORDER_DETAIL_INCLUDE,
      });

      return WorkOrderMapper.toDomain(record);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConcurrencyException(
          'Ordem de serviço foi modificada por outra operação. Tente novamente.',
        );
      }
      throw error;
    }
  }

  async generateNextNumber(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ next: bigint }[]>`
      SELECT nextval('work_order_number_seq') AS next
    `;

    return String(rows[0].next);
  }

  async addServiceItems(items: WorkOrderService[]): Promise<void> {
    try {
      await this.prisma.workOrderService.createMany({
        data: items.map((item) => ({
          workOrderId: item.workOrderId,
          serviceId: item.serviceId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          status: item.status,
          startedAt: item.startedAt,
          finishedAt: item.finishedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ResourceConflictException(
          'Itens duplicados detectados ao aplicar itens na ordem de serviço.',
        );
      }
      throw error;
    }
  }

  async updateServiceItemStatus(workOrder: WorkOrder, item: WorkOrderService): Promise<void> {
    try {
      await this.prisma.workOrderService.update({
        where: {
          workOrderId_serviceId: { workOrderId: item.workOrderId, serviceId: item.serviceId },
        },
        data: {
          status: item.status,
          startedAt: item.startedAt,
          finishedAt: item.finishedAt,
          updatedAt: item.updatedAt,
        },
      });
      await this.prisma.workOrder.update({
        where: { id: workOrder.id, version: workOrder.version },
        data: {
          status: workOrder.status,
          startedAt: workOrder.startedAt,
          finishedAt: workOrder.finishedAt,
          updatedAt: workOrder.updatedAt,
          version: { increment: 1 },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConcurrencyException(
          'Ordem de serviço foi modificada por outra operação. Tente novamente.',
        );
      }
      throw error;
    }
  }

  async addPartSupplyItems(items: WorkOrderPartSupply[]): Promise<void> {
    try {
      await this.prisma.workOrderPartSupply.createMany({
        data: items.map((item) => ({
          workOrderId: item.workOrderId,
          partSupplyId: item.partSupplyId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ResourceConflictException(
          'Itens duplicados detectados ao aplicar itens na ordem de serviço.',
        );
      }
      throw error;
    }
  }
}
