import { randomUUID } from 'node:crypto';
import { CreateWorkOrderUseCase } from '@application/use-cases/work-order/create-work-order.use-case';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { Customer } from '@domain/entities/customer.entity';
import { Vehicle } from '@domain/entities/vehicle.entity';
import { User } from '@domain/entities/user.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { UserRole } from '@domain/enums/user-role.enum';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IVehicleRepository } from '@domain/interfaces/repositories/vehicle.repository.interface';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import {
  createMockCustomer,
  createMockCustomerRepository,
} from '../../../../helpers/customer-mock.factory';
import {
  createMockVehicle,
  createMockVehicleRepository,
} from '../../../../helpers/vehicle-mock.factory';
import { createMockUser, createMockUserRepository } from '../../../../helpers/user-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import {
  createMockBillingQuotesGateway,
  readInternalQuoteSummaryFixture,
} from '../../../../helpers/billing-quotes-gateway-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';

describe('CreateWorkOrderUseCase', () => {
  let useCase: CreateWorkOrderUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let customerRepository: jest.Mocked<ICustomerRepository>;
  let vehicleRepository: jest.Mocked<IVehicleRepository>;
  let userRepository: jest.Mocked<IUserRepository>;
  let billingQuotesGateway: jest.Mocked<IBillingQuotesGateway>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let customer: Customer;
  let vehicle: Vehicle;

  beforeEach(() => {
    const mockUnitOfWork = createMockUnitOfWorkWithRepos();
    unitOfWork = mockUnitOfWork.unitOfWork;
    repos = mockUnitOfWork.repos;

    customerRepository = createMockCustomerRepository();

    vehicleRepository = createMockVehicleRepository();

    userRepository = createMockUserRepository();

    billingQuotesGateway = createMockBillingQuotesGateway();

    logger = createMockLogger();

    metrics = createMockMetrics();

    customer = createMockCustomer();
    vehicle = createMockVehicle({ customerId: customer.id });

    customerRepository.findById.mockResolvedValue(customer);
    vehicleRepository.findById.mockResolvedValue(vehicle);
    (repos.workOrder.generateNextNumber as jest.Mock).mockResolvedValue('000001');
    (repos.workOrder.create as jest.Mock).mockImplementation((workOrder: WorkOrder) =>
      Promise.resolve(workOrder),
    );

    useCase = new CreateWorkOrderUseCase(
      unitOfWork,
      customerRepository,
      vehicleRepository,
      userRepository,
      billingQuotesGateway,
      logger,
      metrics,
    );
  });

  it('should create a work order and initial status history', async () => {
    const result = await useCase.execute({
      customerId: customer.id,
      vehicleId: vehicle.id,
      userId: randomUUID(),
    });

    expect(result.status).toBe(WorkOrderStatus.RECEIVED);
    expect(result.customer).toBe(customer);
    expect(result.vehicle).toBe(vehicle);

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: WorkOrderStatus.RECEIVED, previousStatus: null }),
    );
  });

  it('should create a work order with assigned user (active mechanic)', async () => {
    const mechanic = createMockUser({ role: UserRole.MECHANIC });

    userRepository.findById.mockResolvedValue(mechanic);

    const result = await useCase.execute({
      customerId: customer.id,
      vehicleId: vehicle.id,
      assignedUserId: mechanic.id,
      userId: randomUUID(),
    });

    expect(result.assignedUser).toBe(mechanic);

    expect(repos.workOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({ assignedUserId: mechanic.id }),
    );
  });

  it('should set changedById to null when userId is not provided', async () => {
    await useCase.execute({
      customerId: customer.id,
      vehicleId: vehicle.id,
      userId: undefined as unknown as string,
    });

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ changedById: null }),
    );
  });

  it('should open the work order after the Billing creates the initial quote with the same work order id', async () => {
    const services = [{ serviceId: randomUUID(), quantity: 2 }];
    const partsSupplies = [{ partSupplyId: randomUUID(), quantity: 3 }];

    billingQuotesGateway.createInitialQuote.mockResolvedValue(
      readInternalQuoteSummaryFixture().data,
    );

    const result = await useCase.execute({
      customerId: customer.id,
      vehicleId: vehicle.id,
      userId: randomUUID(),
      services,
      partsSupplies,
    });

    const [quoteInput] = billingQuotesGateway.createInitialQuote.mock.calls[0];
    const [created] = (repos.workOrder.create as jest.Mock).mock.calls[0] as [WorkOrder];

    expect(quoteInput).toEqual({ workOrderId: expect.any(String), services, partsSupplies });
    expect(created.id).toBe(quoteInput.workOrderId);
    expect(result.id).toBe(quoteInput.workOrderId);

    expect(billingQuotesGateway.createInitialQuote.mock.invocationCallOrder[0]).toBeLessThan(
      unitOfWork.executeTransaction.mock.invocationCallOrder[0],
    );
  });

  it('should not call the Billing for a work order without items', async () => {
    await useCase.execute({
      customerId: customer.id,
      vehicleId: vehicle.id,
      userId: randomUUID(),
      services: [],
      partsSupplies: [],
    });

    expect(billingQuotesGateway.createInitialQuote).not.toHaveBeenCalled();
    expect(repos.workOrder.create).toHaveBeenCalledTimes(1);
  });

  it('should send parts without services to the Billing and open nothing on its 409', async () => {
    const partsSupplies = [{ partSupplyId: randomUUID(), quantity: 1 }];

    const rejection = new ServiceRequestRejectedException(
      409,
      'O orçamento precisa de ao menos um serviço',
    );

    billingQuotesGateway.createInitialQuote.mockRejectedValue(rejection);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
        partsSupplies,
      }),
    ).rejects.toBe(rejection);

    expect(billingQuotesGateway.createInitialQuote).toHaveBeenCalledWith(
      expect.objectContaining({ services: [], partsSupplies }),
    );

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
  });

  describe('participants', () => {
    const owner = createMockCustomer();
    const ownVehicle = createMockVehicle({ customerId: owner.id });
    const mechanic = createMockUser({ role: UserRole.MECHANIC });

    it.each<{
      subject: string;
      scenario: string;
      found: { customer: Customer | null; vehicle: Vehicle | null; user: User | null };
      error: new (...args: never[]) => Error;
    }>([
      {
        subject: 'customer',
        scenario: 'not found',
        found: { customer: null, vehicle: ownVehicle, user: mechanic },
        error: ResourceNotFoundException,
      },
      {
        subject: 'customer',
        scenario: 'inactive',
        found: {
          customer: createMockCustomer({ id: owner.id, isActive: false }),
          vehicle: ownVehicle,
          user: mechanic,
        },
        error: BusinessRuleViolationException,
      },
      {
        subject: 'vehicle',
        scenario: 'not found',
        found: { customer: owner, vehicle: null, user: mechanic },
        error: ResourceNotFoundException,
      },
      {
        subject: 'vehicle',
        scenario: 'of another customer',
        found: { customer: owner, vehicle: createMockVehicle(), user: mechanic },
        error: BusinessRuleViolationException,
      },
      {
        subject: 'mechanic',
        scenario: 'not found',
        found: { customer: owner, vehicle: ownVehicle, user: null },
        error: ResourceNotFoundException,
      },
      {
        subject: 'mechanic',
        scenario: 'not a mechanic',
        found: { customer: owner, vehicle: ownVehicle, user: createMockUser() },
        error: BusinessRuleViolationException,
      },
      {
        subject: 'mechanic',
        scenario: 'inactive',
        found: {
          customer: owner,
          vehicle: ownVehicle,
          user: createMockUser({ role: UserRole.MECHANIC, isActive: false }),
        },
        error: BusinessRuleViolationException,
      },
    ])(
      'should validate the $subject before calling the Billing ($scenario)',
      async ({ found, error }) => {
        customerRepository.findById.mockResolvedValue(found.customer);
        vehicleRepository.findById.mockResolvedValue(found.vehicle);
        userRepository.findById.mockResolvedValue(found.user);

        await expect(
          useCase.execute({
            customerId: owner.id,
            vehicleId: ownVehicle.id,
            assignedUserId: mechanic.id,
            userId: randomUUID(),
            services: [{ serviceId: randomUUID(), quantity: 1 }],
          }),
        ).rejects.toThrow(error);

        expect(billingQuotesGateway.createInitialQuote).not.toHaveBeenCalled();
        expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
      },
    );
  });

  it('should let a Billing rejection through and open nothing', async () => {
    const rejection = new ServiceRequestRejectedException(
      404,
      'Serviço não encontrado(a) com identificador: x',
    );

    billingQuotesGateway.createInitialQuote.mockRejectedValue(rejection);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
        services: [{ serviceId: randomUUID(), quantity: 1 }],
      }),
    ).rejects.toBe(rejection);

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
    expect(metrics.increment).not.toHaveBeenCalled();
  });

  it('should answer 503 and open nothing when the Billing is unavailable', async () => {
    const unavailable = new ServiceIntegrationException('Serviço de destino indisponível');

    billingQuotesGateway.createInitialQuote.mockRejectedValue(unavailable);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
        services: [{ serviceId: randomUUID(), quantity: 1 }],
      }),
    ).rejects.toBe(unavailable);

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
  });

  it('should delete the initial quote and rethrow when the work order write fails', async () => {
    const quote = readInternalQuoteSummaryFixture().data;
    const writeError = new Error('write failed');

    billingQuotesGateway.createInitialQuote.mockResolvedValue(quote);
    (repos.statusHistory.create as jest.Mock).mockRejectedValue(writeError);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
        services: [{ serviceId: randomUUID(), quantity: 1 }],
      }),
    ).rejects.toBe(writeError);

    expect(billingQuotesGateway.deleteQuote).toHaveBeenCalledWith(quote.id);
    expect(logger.event).not.toHaveBeenCalled();
    expect(metrics.increment).not.toHaveBeenCalled();
  });

  it('should log the orphan quote and rethrow the write error when the compensation fails', async () => {
    const quote = readInternalQuoteSummaryFixture().data;
    const writeError = new Error('write failed');

    billingQuotesGateway.createInitialQuote.mockResolvedValue(quote);
    billingQuotesGateway.deleteQuote.mockRejectedValue(
      new ServiceIntegrationException('Serviço de destino indisponível'),
    );
    (repos.statusHistory.create as jest.Mock).mockRejectedValue(writeError);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
        services: [{ serviceId: randomUUID(), quantity: 1 }],
      }),
    ).rejects.toBe(writeError);

    const [{ workOrderId }] = billingQuotesGateway.createInitialQuote.mock.calls[0];

    expect(logger.event).toHaveBeenCalledWith(
      BUSINESS_EVENTS.WORK_ORDER_OPENING_COMPENSATION_FAILED,
      { quoteId: quote.id, workOrderId },
    );
  });

  describe('volume metric', () => {
    it('should count an actually created order exactly once', async () => {
      await useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
      });

      expect(metrics.increment).toHaveBeenCalledTimes(1);
      expect(metrics.increment).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'work_order.created', kind: 'counter' }),
        {},
      );
    });

    /**
     * Emission happens **after** the `await`: Prisma only requests the COMMIT
     * when the `$transaction` callback returns, so counting inside it would
     * include what may still be rolled back.
     */
    it('should not count when the transaction throws', async () => {
      (repos.workOrder.create as jest.Mock).mockRejectedValue(new Error('rollback'));

      await expect(
        useCase.execute({ customerId: customer.id, vehicleId: vehicle.id, userId: randomUUID() }),
      ).rejects.toThrow('rollback');

      expect(metrics.increment).not.toHaveBeenCalled();
      expect(billingQuotesGateway.deleteQuote).not.toHaveBeenCalled();
    });

    it('should emit only after the transaction returns', async () => {
      const calls: string[] = [];

      (unitOfWork.executeTransaction as jest.Mock).mockImplementation(
        async (work: (transactionRepos: IRepositories) => Promise<unknown>) => {
          const result = await work(repos);
          calls.push('commit');

          return result;
        },
      );
      metrics.increment.mockImplementation(() => {
        calls.push('increment');
      });

      await useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
      });

      expect(calls).toEqual(['commit', 'increment']);
    });
  });
});
