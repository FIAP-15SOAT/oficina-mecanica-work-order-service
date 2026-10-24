import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IVehicleRepository } from '@domain/interfaces/repositories/vehicle.repository.interface';
import { IServiceRepository } from '@domain/interfaces/repositories/service.repository.interface';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { createMockWorkOrderRepository } from './work-order-mock.factory';
import { createMockStatusHistoryRepository } from './status-history-mock.factory';
import { createMockStockMovementRepository } from './stock-movement-mock.factory';
import { createMockStockReservationRepository } from './stock-reservation-mock.factory';
import { createMockQuoteRepository } from './quote-mock.factory';
import { createMockPartSupplyRepository } from './part-supply-mock.factory';
import { createMockOutboxRepository } from './outbox-mock.factory';

export function createMockRepositories(): jest.Mocked<IRepositories> {
  return {
    customer: {
      create: jest.fn(),
      findById: jest.fn(),
      findByDocument: jest.fn(),
      findByEmail: jest.fn(),
      findAllPaginated: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      isCustomerInUse: jest.fn(),
      hasWorkOrders: jest.fn().mockResolvedValue(false),
    },
    vehicle: {
      create: jest.fn(),
      findById: jest.fn(),
      findByPlate: jest.fn(),
      findAllPaginated: jest.fn(),
      findByCustomerId: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      isVehicleInUse: jest.fn(),
    } as unknown as jest.Mocked<IVehicleRepository>,
    workOrder: createMockWorkOrderRepository(),
    quote: createMockQuoteRepository(),
    statusHistory: createMockStatusHistoryRepository(),
    stockReservation: createMockStockReservationRepository(),
    stockMovement: createMockStockMovementRepository(),
    partSupply: createMockPartSupplyRepository(),
    service: {
      create: jest.fn(),
      findById: jest.fn(),
      findByIds: jest.fn(),
      findByName: jest.fn(),
      findAllPaginated: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      isServiceInUse: jest.fn(),
      getServiceMetrics: jest.fn(),
      getAllServicesMetrics: jest.fn(),
    } as unknown as jest.Mocked<IServiceRepository>,
    user: {
      create: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByCpf: jest.fn(),
      findByUsername: jest.fn(),
      findAllPaginated: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<IUserRepository>,
    userCustomer: {
      create: jest.fn(),
      exists: jest.fn(),
      existsActiveLink: jest.fn(),
      delete: jest.fn(),
      findUsersByCustomerId: jest.fn(),
      findCustomersByUserId: jest.fn(),
      findActiveCustomerIdsByUserId: jest.fn(),
    },
    passwordResetCode: {
      upsert: jest.fn(),
      findByUserId: jest.fn(),
      incrementAttempts: jest.fn(),
      delete: jest.fn(),
    },
    outbox: createMockOutboxRepository(),
  };
}

export function createMockUnitOfWork(): jest.Mocked<IUnitOfWork> {
  const repos = createMockRepositories();
  return {
    executeTransaction: jest
      .fn()
      .mockImplementation((work: (repos: IRepositories) => Promise<unknown>) => work(repos)),
  };
}

export function createMockUnitOfWorkWithRepos(): {
  unitOfWork: jest.Mocked<IUnitOfWork>;
  repos: jest.Mocked<IRepositories>;
} {
  const repos = createMockRepositories();
  const unitOfWork: jest.Mocked<IUnitOfWork> = {
    executeTransaction: jest
      .fn()
      .mockImplementation((work: (repos: IRepositories) => Promise<unknown>) => work(repos)),
  };
  return { unitOfWork, repos };
}
