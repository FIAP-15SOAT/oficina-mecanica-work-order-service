import { Injectable } from '@nestjs/common';
import { Prisma, Service as PrismaServiceModel } from '@generated/client';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { Service } from '@domain/entities/service.entity';
import {
  IServiceRepository,
  ServiceFilters,
} from '@domain/interfaces/repositories/service.repository.interface';
import { PrismaService } from '../prisma.service';
import { ServiceMapper } from '@infrastructure/persistence/prisma/mappers/service.mapper';
import {
  PaginatedRepositoryResult,
  PaginationInput,
} from '@domain/interfaces/common/pagination.interface';
import { paginate } from '@infrastructure/persistence/prisma/helpers/prisma-paginate.helper';
import { existsBy } from '@infrastructure/persistence/prisma/helpers/prisma-exists.helper';

@Injectable()
export class PrismaServiceRepository implements IServiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(service: Service): Promise<Service> {
    try {
      const createdService = await this.prisma.service.create({
        data: {
          name: service.name,
          description: service.description,
          basePrice: service.basePrice,
          estimatedTimeMin: service.estimatedTimeMin,
        },
      });

      return ServiceMapper.toDomain(createdService);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ResourceConflictException('Serviço já cadastrado');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Service | null> {
    const serviceRecord = await this.prisma.service.findUnique({ where: { id } });

    return serviceRecord ? ServiceMapper.toDomain(serviceRecord) : null;
  }

  async findByIds(ids: string[]): Promise<Service[]> {
    const records = await this.prisma.service.findMany({
      where: { id: { in: ids } },
    });

    return records.map((r) => ServiceMapper.toDomain(r));
  }

  async findByName(name: string): Promise<Service | null> {
    const serviceRecord = await this.prisma.service.findFirst({ where: { name } });

    return serviceRecord ? ServiceMapper.toDomain(serviceRecord) : null;
  }

  async findAllPaginated(
    pagination: PaginationInput,
    filters: ServiceFilters,
  ): Promise<PaginatedRepositoryResult<Service>> {
    const { name } = filters;

    const where: Prisma.ServiceWhereInput = {};

    if (name) {
      where.name = { contains: name.trim(), mode: 'insensitive' };
    }

    const result = await paginate(
      this.prisma.service,
      {
        where,
        orderBy: { createdAt: 'desc' },
      },
      pagination,
    );

    return {
      items: result.items.map((record: PrismaServiceModel) => ServiceMapper.toDomain(record)),
      total: result.total,
    };
  }

  async update(service: Service): Promise<Service> {
    const updatedService = await this.prisma.service.update({
      where: { id: service.id },
      data: {
        name: service.name,
        description: service.description,
        basePrice: service.basePrice,
        estimatedTimeMin: service.estimatedTimeMin,
      },
    });

    return ServiceMapper.toDomain(updatedService);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.service.delete({ where: { id } });
  }

  async isServiceInUse(serviceId: string): Promise<boolean> {
    const [workOrderUsage, quoteUsage] = await Promise.all([
      existsBy(this.prisma.workOrderService, { serviceId }),
      existsBy(this.prisma.quoteService, { serviceId }),
    ]);

    return workOrderUsage || quoteUsage;
  }
}
