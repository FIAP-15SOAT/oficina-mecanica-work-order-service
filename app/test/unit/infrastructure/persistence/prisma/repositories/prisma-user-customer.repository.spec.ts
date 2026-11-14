import { randomUUID } from 'node:crypto';
import { Prisma } from '@generated/client';

import { PrismaUserCustomerRepository } from '@infrastructure/persistence/prisma/repositories/prisma-user-customer.repository';
import { UserCustomer } from '@domain/entities/user-customer.entity';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import {
  createMockPrismaClient,
  MockPrismaService,
} from '../../../../../helpers/prisma-mock.factory';
import { createMockPrismaCustomer } from '../../../../../helpers/customer-mock.factory';

describe('PrismaUserCustomerRepository', () => {
  let repository: PrismaUserCustomerRepository;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaClient();
    repository = new PrismaUserCustomerRepository(prisma);
  });

  describe('create', () => {
    it('should create the link', async () => {
      const userId = randomUUID();
      const customerId = randomUUID();
      const link = UserCustomer.create({ userId, customerId });

      prisma.userCustomer.create.mockResolvedValue({
        userId,
        customerId,
        createdAt: link.createdAt,
      });

      const result = await repository.create(link);

      expect(result.userId).toBe(userId);
      expect(prisma.userCustomer.create).toHaveBeenCalledWith({
        data: { userId, customerId },
      });
    });

    it('should throw ResourceConflictException on P2002', async () => {
      const userId = randomUUID();
      const customerId = randomUUID();
      const link = UserCustomer.create({ userId, customerId });

      const error = new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      prisma.userCustomer.create.mockRejectedValue(error);

      await expect(repository.create(link)).rejects.toThrow(ResourceConflictException);
    });

    it('should rethrow unexpected errors', async () => {
      const userId = randomUUID();
      const customerId = randomUUID();
      const link = UserCustomer.create({ userId, customerId });

      const error = new Error('Database connection lost');
      prisma.userCustomer.create.mockRejectedValue(error);

      await expect(repository.create(link)).rejects.toThrow('Database connection lost');
    });
  });

  describe('exists', () => {
    it('should return true when a link is found', async () => {
      prisma.userCustomer.findUnique.mockResolvedValue({
        userId: randomUUID(),
        customerId: randomUUID(),
        createdAt: new Date(),
      });

      const result = await repository.exists(randomUUID(), randomUUID());

      expect(result).toBe(true);
    });

    it('should return false when no link is found', async () => {
      prisma.userCustomer.findUnique.mockResolvedValue(null);

      const result = await repository.exists(randomUUID(), randomUUID());

      expect(result).toBe(false);
    });
  });

  describe('existsActiveLink', () => {
    it('should return true when the link exists and the customer is active', async () => {
      const userId = randomUUID();
      const customerId = randomUUID();
      prisma.userCustomer.findFirst.mockResolvedValue({ userId });

      const result = await repository.existsActiveLink(userId, customerId);

      expect(result).toBe(true);
      expect(prisma.userCustomer.findFirst).toHaveBeenCalledWith({
        where: { userId, customerId, customer: { isActive: true } },
        select: { userId: true },
      });
    });

    it('should return false when no active link is found', async () => {
      prisma.userCustomer.findFirst.mockResolvedValue(null);

      const result = await repository.existsActiveLink(randomUUID(), randomUUID());

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete the link by composite key', async () => {
      const userId = randomUUID();
      const customerId = randomUUID();

      await repository.delete(userId, customerId);

      expect(prisma.userCustomer.delete).toHaveBeenCalledWith({
        where: { userId_customerId: { userId, customerId } },
      });
    });
  });

  describe('findUserIdsByCustomerId', () => {
    it('should return only the ids of the linked users', async () => {
      const customerId = randomUUID();
      const userId = randomUUID();

      prisma.userCustomer.findMany.mockResolvedValue([{ userId }]);

      const result = await repository.findUserIdsByCustomerId(customerId);

      expect(result).toEqual([userId]);

      expect(prisma.userCustomer.findMany).toHaveBeenCalledWith({
        where: { customerId },
        select: { userId: true },
      });
    });
  });

  describe('findCustomersByUserId', () => {
    it('should return the linked customers', async () => {
      const userId = randomUUID();
      prisma.userCustomer.findMany.mockResolvedValue([
        {
          customer: createMockPrismaCustomer({}),
          userId,
          customerId: randomUUID(),
          createdAt: new Date(),
        },
      ]);

      const result = await repository.findCustomersByUserId(userId);

      expect(result).toHaveLength(1);
      expect(prisma.userCustomer.findMany).toHaveBeenCalledWith({
        where: { userId },
        include: { customer: { include: { address: true } } },
      });
    });
  });

  describe('findActiveCustomersByUserId', () => {
    it('should return only the customers of active links', async () => {
      const userId = randomUUID();
      const customer = createMockPrismaCustomer({});
      prisma.userCustomer.findMany.mockResolvedValue([
        { customer, userId, customerId: customer.id, createdAt: new Date() },
      ]);

      const result = await repository.findActiveCustomersByUserId(userId);

      expect(result.map((item) => item.id)).toEqual([customer.id]);

      expect(prisma.userCustomer.findMany).toHaveBeenCalledWith({
        where: { userId, customer: { isActive: true } },
        include: { customer: { include: { address: true } } },
      });
    });
  });

  describe('findActiveCustomerIdsByUserId', () => {
    it('should return only active customer ids', async () => {
      const userId = randomUUID();
      const activeId = randomUUID();
      prisma.userCustomer.findMany.mockResolvedValue([
        { customerId: activeId, customer: { isActive: true } },
      ]);

      const result = await repository.findActiveCustomerIdsByUserId(userId);

      expect(result).toEqual([activeId]);
      expect(prisma.userCustomer.findMany).toHaveBeenCalledWith({
        where: { userId, customer: { isActive: true } },
        select: { customerId: true },
      });
    });
  });
});
