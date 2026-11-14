import { Injectable } from '@nestjs/common';
import { Prisma } from '@generated/client';

import { PrismaService } from '../prisma.service';

import { StatusHistory } from '@domain/entities/status-history.entity';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { StatusHistoryMapper } from '@infrastructure/persistence/prisma/mappers/status-history.mapper';

@Injectable()
export class PrismaStatusHistoryRepository implements IStatusHistoryRepository {
  private readonly prisma: PrismaService | Prisma.TransactionClient;

  constructor(prisma: PrismaService) {
    this.prisma = prisma;
  }

  async create(entry: StatusHistory): Promise<StatusHistory> {
    const record = await this.prisma.statusHistory.create({
      data: {
        id: entry.id,
        workOrderId: entry.workOrderId,
        changedById: entry.changedById,
        previousStatus: entry.previousStatus,
        newStatus: entry.newStatus,
        notes: entry.notes,
      },
    });

    return StatusHistoryMapper.toDomain(record);
  }

  async findByWorkOrderId(workOrderId: string): Promise<StatusHistory[]> {
    const records = await this.prisma.statusHistory.findMany({
      where: { workOrderId },
      orderBy: { createdAt: 'asc' },
    });

    return records.map((r) => StatusHistoryMapper.toDomain(r));
  }
}
