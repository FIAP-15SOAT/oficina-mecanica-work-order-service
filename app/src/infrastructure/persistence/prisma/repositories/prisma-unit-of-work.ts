import { Injectable } from '@nestjs/common';
import { Prisma } from '@generated/client';

import { PrismaService } from '@infrastructure/persistence/prisma/prisma.service';

import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { PrismaCustomerRepository } from './prisma-customer.repository';
import { PrismaVehicleRepository } from './prisma-vehicle.repository';
import { PrismaWorkOrderRepository } from './prisma-work-order.repository';
import { PrismaQuoteRepository } from './prisma-quote.repository';
import { PrismaStatusHistoryRepository } from './prisma-status-history.repository';
import { PrismaStockReservationRepository } from './prisma-stock-reservation.repository';
import { PrismaStockMovementRepository } from './prisma-stock-movement.repository';
import { PrismaPartSupplyRepository } from './prisma-part-supply.repository';
import { PrismaServiceRepository } from './prisma-service.repository';
import { PrismaUserRepository } from './prisma-user.repository';
import { PrismaUserCustomerRepository } from './prisma-user-customer.repository';
import { PrismaPasswordResetCodeRepository } from './prisma-password-reset-code.repository';
import { PrismaOutboxRepository } from './prisma-outbox.repository';

@Injectable()
export class PrismaUnitOfWork implements IUnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  async executeTransaction<T>(work: (repositories: IRepositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const repositories: IRepositories = {
        customer: new PrismaCustomerRepository(tx as unknown as PrismaService),
        vehicle: new PrismaVehicleRepository(tx as unknown as PrismaService),
        workOrder: new PrismaWorkOrderRepository(tx as unknown as PrismaService),
        quote: new PrismaQuoteRepository(tx as unknown as PrismaService),
        statusHistory: new PrismaStatusHistoryRepository(tx as unknown as PrismaService),
        stockReservation: new PrismaStockReservationRepository(tx as unknown as PrismaService),
        stockMovement: new PrismaStockMovementRepository(tx as unknown as PrismaService),
        partSupply: new PrismaPartSupplyRepository(tx as unknown as PrismaService),
        service: new PrismaServiceRepository(tx as unknown as PrismaService),
        user: new PrismaUserRepository(tx as unknown as PrismaService),
        userCustomer: new PrismaUserCustomerRepository(tx as unknown as PrismaService),
        passwordResetCode: new PrismaPasswordResetCodeRepository(tx as unknown as PrismaService),
        outbox: new PrismaOutboxRepository(tx as unknown as PrismaService),
      };

      return work(repositories);
    });
  }
}
