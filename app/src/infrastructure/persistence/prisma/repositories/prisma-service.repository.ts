import { Injectable } from '@nestjs/common';
import { Prisma, Service as PrismaServiceModel } from '@generated/client';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { Service } from '@domain/entities/service.entity';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import {
  IServiceRepository,
  ServiceFilters,
  ServiceMetrics,
} from '@domain/interfaces/repositories/service.repository.interface';
import { PrismaService } from '../prisma.service';
import { ServiceMapper } from '@infrastructure/persistence/prisma/mappers/service.mapper';
import { DatabaseOperationException } from '@infrastructure/exceptions/database-operation.exception';
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

  async findServiceMetrics(serviceId: string): Promise<ServiceMetrics> {
    const rows = await this.prisma.$queryRaw<
      {
        service_id: string;
        service_name: string;
        execution_count: bigint;
        avg_minutes: number | null;
      }[]
    >`
      SELECT
        s.id AS service_id,
        s.name AS service_name,
        COUNT(wos.service_id) AS execution_count,
        AVG(
          EXTRACT(EPOCH FROM (wos.finished_at - wos.started_at)) / 60.0
        ) AS avg_minutes
      FROM services s
      LEFT JOIN work_order_services wos
        ON wos.service_id = s.id
        AND wos.status = ${WorkOrderServiceStatus.COMPLETED}::"WorkOrderServiceStatus"
        AND wos.started_at IS NOT NULL
        AND wos.finished_at IS NOT NULL
      WHERE s.id = ${serviceId}
      GROUP BY s.id, s.name
    `;

    if (rows.length === 0) {
      throw new DatabaseOperationException(`Métricas não encontradas para o serviço: ${serviceId}`);
    }

    const row = rows[0];

    return {
      serviceId,
      serviceName: row.service_name,
      executionCount: Number(row.execution_count),
      averageTimeMinutes:
        row?.avg_minutes == null ? null : Number.parseFloat(Number(row.avg_minutes).toFixed(2)),
    };
  }

  async findAllServicesMetrics(
    input: PaginationInput,
  ): Promise<PaginatedRepositoryResult<ServiceMetrics>> {
    const { page, limit } = input;

    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<
        {
          service_id: string;
          service_name: string;
          execution_count: bigint;
          avg_minutes: number | null;
        }[]
      >`
        SELECT
          s.id AS service_id,
          s.name AS service_name,
          COUNT(wos.service_id) AS execution_count,
          AVG(
            CASE WHEN wos.started_at IS NOT NULL AND wos.finished_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (wos.finished_at - wos.started_at)) / 60.0
              ELSE NULL
            END
          ) AS avg_minutes
        FROM services s
        LEFT JOIN work_order_services wos
          ON wos.service_id = s.id AND wos.status = ${WorkOrderServiceStatus.COMPLETED}::"WorkOrderServiceStatus"
          AND wos.started_at IS NOT NULL
          AND wos.finished_at IS NOT NULL
        GROUP BY s.id, s.name
        ORDER BY s.name ASC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}
      `,

      this.prisma.service.count(),
    ]);

    return {
      items: rows.map((row) => ({
        serviceId: row.service_id,
        serviceName: row.service_name,
        executionCount: Number(row.execution_count),
        averageTimeMinutes:
          row.avg_minutes == null ? null : Number.parseFloat(Number(row.avg_minutes).toFixed(2)),
      })),
      total,
    };
  }
}
