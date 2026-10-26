import { PrismaService } from '@infrastructure/persistence/prisma/prisma.service';

type MockDelegate = {
  create: jest.Mock;
  findUnique: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  updateMany: jest.Mock;
  deleteMany: jest.Mock;
  upsert: jest.Mock;
  createMany: jest.Mock;
  fields?: Record<string, unknown>;
};

const createMockDelegate = (): MockDelegate => ({
  create: jest.fn(),
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  updateMany: jest.fn(),
  deleteMany: jest.fn(),
  upsert: jest.fn(),
  createMany: jest.fn(),
  fields: {},
});

export type MockPrismaService = {
  service: MockDelegate;
  user: MockDelegate;
  customer: MockDelegate;
  address: MockDelegate;
  vehicle: MockDelegate;
  workOrder: MockDelegate;
  quote: MockDelegate;
  quotePartSupply: MockDelegate;
  quoteService: MockDelegate;
  partSupply: MockDelegate;
  stockReservation: MockDelegate;
  stockMovement: MockDelegate;
  workOrderService: MockDelegate;
  workOrderPartSupply: MockDelegate;
  statusHistory: MockDelegate;
  userCustomer: MockDelegate;
  passwordResetCode: MockDelegate;
  outboxMessage: MockDelegate;
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  pool: { query: jest.Mock };
} & PrismaService;

export function createMockPrismaClient(): MockPrismaService {
  return {
    service: createMockDelegate(),
    user: createMockDelegate(),
    customer: createMockDelegate(),
    address: createMockDelegate(),
    vehicle: createMockDelegate(),
    workOrder: createMockDelegate(),
    quote: createMockDelegate(),
    quotePartSupply: createMockDelegate(),
    quoteService: createMockDelegate(),
    partSupply: { ...createMockDelegate(), fields: { minStock: 'minStockReference' } },
    stockReservation: createMockDelegate(),
    stockMovement: createMockDelegate(),
    workOrderService: createMockDelegate(),
    workOrderPartSupply: createMockDelegate(),
    statusHistory: createMockDelegate(),
    userCustomer: createMockDelegate(),
    passwordResetCode: createMockDelegate(),
    outboxMessage: createMockDelegate(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest
      .fn()
      .mockImplementation((arg: ((client: MockPrismaService) => unknown) | unknown[]) => {
        if (typeof arg === 'function') {
          return arg(createMockPrismaClient());
        }
        return Promise.all(arg);
      }),
    $queryRaw: jest.fn(),
    pool: { query: jest.fn() },
  } as unknown as MockPrismaService;
}
