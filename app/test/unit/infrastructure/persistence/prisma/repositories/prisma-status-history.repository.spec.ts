import { randomUUID } from 'node:crypto';

import { PrismaStatusHistoryRepository } from '@infrastructure/persistence/prisma/repositories/prisma-status-history.repository';

import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

import {
  createMockPrismaClient,
  MockPrismaService,
} from '../../../../../helpers/prisma-mock.factory';

describe('PrismaStatusHistoryRepository', () => {
  let repository: PrismaStatusHistoryRepository;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaClient();
    repository = new PrismaStatusHistoryRepository(prisma);
  });

  describe('create', () => {
    it('should create a status history', async () => {
      const history = StatusHistory.create({
        workOrderId: randomUUID(),
        newStatus: WorkOrderStatus.IN_DIAGNOSIS,
      });

      prisma.statusHistory.create.mockResolvedValue({
        id: history.id,
        workOrderId: history.workOrderId,
        changedById: history.changedById,
        previousStatus: history.previousStatus,
        newStatus: history.newStatus,
        notes: history.notes,
        createdAt: history.createdAt,
      });

      const result = await repository.create(history);

      expect(result.id).toBe(history.id);
      expect(prisma.statusHistory.create).toHaveBeenCalled();
    });
  });

  describe('findByWorkOrderId', () => {
    it('should return history for a work order', async () => {
      prisma.statusHistory.findMany.mockResolvedValue([
        {
          id: randomUUID(),
          workOrderId: randomUUID(),
          changedById: null,
          previousStatus: null,
          newStatus: WorkOrderStatus.IN_DIAGNOSIS,
          notes: null,
          createdAt: new Date(),
        },
      ]);

      const result = await repository.findByWorkOrderId(randomUUID());

      expect(result).toHaveLength(1);
    });

    /**
     * The order is part of the `IStatusHistoryRepository` contract, not a detail
     * of this repository: `measureWorkOrderDurations` anchors dwell on the last
     * entry that opened the status and totals on the first. Without this
     * assertion, changing the `orderBy` — or removing it — passes every test and
     * corrupts the durations silently, because the emitted data carries no sign
     * that the order changed.
     */
    it('should ask the database for chronologically ascending history', async () => {
      prisma.statusHistory.findMany.mockResolvedValue([]);

      const workOrderId = randomUUID();

      await repository.findByWorkOrderId(workOrderId);

      expect(prisma.statusHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workOrderId },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });
  });
});
