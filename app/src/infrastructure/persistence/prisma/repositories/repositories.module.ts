import { Global, Module } from '@nestjs/common';

import { PrismaUserRepository } from './prisma-user.repository';
import { PrismaUserCustomerRepository } from './prisma-user-customer.repository';
import { PrismaPasswordResetCodeRepository } from './prisma-password-reset-code.repository';
import { PrismaCustomerRepository } from './prisma-customer.repository';
import { PrismaVehicleRepository } from './prisma-vehicle.repository';
import { PrismaWorkOrderRepository } from './prisma-work-order.repository';
import { PrismaQuoteRepository } from './prisma-quote.repository';
import { PrismaStatusHistoryRepository } from './prisma-status-history.repository';
import { PrismaSagaInstanceRepository } from './prisma-saga-instance.repository';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

const REPOSITORY_PROVIDERS = [
  { provide: 'IUserRepository', useClass: PrismaUserRepository },
  { provide: 'IUserCustomerRepository', useClass: PrismaUserCustomerRepository },
  { provide: 'IPasswordResetCodeRepository', useClass: PrismaPasswordResetCodeRepository },
  { provide: 'ICustomerRepository', useClass: PrismaCustomerRepository },
  { provide: 'IVehicleRepository', useClass: PrismaVehicleRepository },
  { provide: 'IWorkOrderRepository', useClass: PrismaWorkOrderRepository },
  { provide: 'IQuoteRepository', useClass: PrismaQuoteRepository },
  { provide: 'IStatusHistoryRepository', useClass: PrismaStatusHistoryRepository },
  { provide: 'ISagaInstanceRepository', useClass: PrismaSagaInstanceRepository },
  { provide: 'IUnitOfWork', useClass: PrismaUnitOfWork },
];

@Global()
@Module({
  providers: REPOSITORY_PROVIDERS,
  exports: REPOSITORY_PROVIDERS,
})
export class RepositoriesModule {}
