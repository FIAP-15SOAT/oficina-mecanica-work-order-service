import { Injectable } from '@nestjs/common';
import { Prisma } from '@generated/client';

import { PrismaService } from '@infrastructure/persistence/prisma/prisma.service';

import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';

import { UserCustomer } from '@domain/entities/user-customer.entity';
import { Customer } from '@domain/entities/customer.entity';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';

import { UserCustomerMapper } from '@infrastructure/persistence/prisma/mappers/user-customer.mapper';
import { CustomerMapper } from '@infrastructure/persistence/prisma/mappers/customer.mapper';

@Injectable()
export class PrismaUserCustomerRepository implements IUserCustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(link: UserCustomer): Promise<UserCustomer> {
    try {
      const record = await this.prisma.userCustomer.create({
        data: { userId: link.userId, customerId: link.customerId },
      });

      return UserCustomerMapper.toDomain(record);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ResourceConflictException('Usuário já possui acesso a este cliente');
      }
      throw error;
    }
  }

  async exists(userId: string, customerId: string): Promise<boolean> {
    const record = await this.prisma.userCustomer.findUnique({
      where: { userId_customerId: { userId, customerId } },
    });

    return record !== null;
  }

  async existsActiveLink(userId: string, customerId: string): Promise<boolean> {
    const record = await this.prisma.userCustomer.findFirst({
      where: { userId, customerId, customer: { isActive: true } },
      select: { userId: true },
    });

    return record !== null;
  }

  async delete(userId: string, customerId: string): Promise<void> {
    await this.prisma.userCustomer.delete({
      where: { userId_customerId: { userId, customerId } },
    });
  }

  async findUserIdsByCustomerId(customerId: string): Promise<string[]> {
    const records = await this.prisma.userCustomer.findMany({
      where: { customerId },
      select: { userId: true },
    });

    return records.map((record) => record.userId);
  }

  async findCustomersByUserId(userId: string): Promise<Customer[]> {
    const records = await this.prisma.userCustomer.findMany({
      where: { userId },
      include: { customer: { include: { address: true } } },
    });

    return records.map((record) => CustomerMapper.toDomain(record.customer));
  }

  async findActiveCustomersByUserId(userId: string): Promise<Customer[]> {
    const records = await this.prisma.userCustomer.findMany({
      where: { userId, customer: { isActive: true } },
      include: { customer: { include: { address: true } } },
    });

    return records.map((record) => CustomerMapper.toDomain(record.customer));
  }

  async findActiveCustomerIdsByUserId(userId: string): Promise<string[]> {
    const records = await this.prisma.userCustomer.findMany({
      where: { userId, customer: { isActive: true } },
      select: { customerId: true },
    });

    return records.map((record) => record.customerId);
  }
}
