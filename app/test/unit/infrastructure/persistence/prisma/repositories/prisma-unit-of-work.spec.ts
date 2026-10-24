import { PrismaUnitOfWork } from '@infrastructure/persistence/prisma/repositories/prisma-unit-of-work';

import {
  createMockPrismaClient,
  MockPrismaService,
} from '../../../../../helpers/prisma-mock.factory';

describe('PrismaUnitOfWork', () => {
  let unitOfWork: PrismaUnitOfWork;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaClient();
    unitOfWork = new PrismaUnitOfWork(prisma);
  });

  describe('executeTransaction', () => {
    it('should execute the work inside a transaction', async () => {
      const mockWork = jest.fn().mockResolvedValue('success');

      const result = await unitOfWork.executeTransaction(mockWork);

      expect(result).toBe('success');
      expect(prisma.$transaction).toHaveBeenCalled();

      // Since the mock of $transaction directly calls the callback with the prisma client,
      // the work function should have been called with the repositories initialized with the transaction client.
      expect(mockWork).toHaveBeenCalled();

      // Check if repositories are passed
      const repos = mockWork.mock.calls[0][0];
      expect(repos).toHaveProperty('workOrder');
      expect(repos).toHaveProperty('quote');
      expect(repos).toHaveProperty('partSupply');
      expect(repos).toHaveProperty('service');
      expect(repos).toHaveProperty('stockReservation');
      expect(repos).toHaveProperty('statusHistory');
      expect(repos).toHaveProperty('customer');
      expect(repos).toHaveProperty('stockMovement');
      expect(repos).toHaveProperty('outbox');
    });

    it('should propagate errors from the work function', async () => {
      const error = new Error('Transaction failed');
      const mockWork = jest.fn().mockRejectedValue(error);

      await expect(unitOfWork.executeTransaction(mockWork)).rejects.toThrow(error);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
