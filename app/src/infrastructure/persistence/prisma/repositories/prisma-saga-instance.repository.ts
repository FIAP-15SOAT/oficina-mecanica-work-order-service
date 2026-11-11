import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma.service';

import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { SagaInstanceMapper } from '@infrastructure/persistence/prisma/mappers/saga-instance.mapper';

@Injectable()
export class PrismaSagaInstanceRepository implements ISagaInstanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTypeAndCorrelationId(
    type: SagaType,
    correlationId: string,
  ): Promise<SagaInstance | null> {
    const record = await this.prisma.sagaInstance.findUnique({
      where: { type_correlationId: { type, correlationId } },
    });

    return record ? SagaInstanceMapper.toDomain(record) : null;
  }

  async hasActiveByWorkOrderId(workOrderId: string): Promise<boolean> {
    const count = await this.prisma.sagaInstance.count({
      where: {
        workOrderId,
        status: { in: [SagaStatus.RESERVING_STOCK, SagaStatus.COMPENSATING] },
      },
    });

    return count > 0;
  }

  async create(saga: SagaInstance): Promise<SagaInstance> {
    const record = await this.prisma.sagaInstance.create({
      data: {
        id: saga.id,
        type: saga.type,
        correlationId: saga.correlationId,
        workOrderId: saga.workOrderId,
        status: saga.status,
        failureReason: saga.failureReason,
      },
    });

    return SagaInstanceMapper.toDomain(record);
  }

  async update(saga: SagaInstance): Promise<SagaInstance> {
    const record = await this.prisma.sagaInstance.update({
      where: { id: saga.id },
      data: { status: saga.status, failureReason: saga.failureReason },
    });

    return SagaInstanceMapper.toDomain(record);
  }
}
