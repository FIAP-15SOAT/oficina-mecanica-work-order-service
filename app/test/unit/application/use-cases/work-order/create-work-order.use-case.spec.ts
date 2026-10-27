import { randomUUID } from 'node:crypto';
import { CreateWorkOrderUseCase } from '@application/use-cases/work-order/create-work-order.use-case';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockCustomer } from '../../../../helpers/customer-mock.factory';
import { createMockVehicle } from '../../../../helpers/vehicle-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { UserRole } from '@domain/enums/user-role.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { createMockService } from '../../../../helpers/service-mock.factory';
import { createMockPartSupply } from '../../../../helpers/part-supply-mock.factory';
import { IMetrics } from '@application/ports/output/metrics.service.interface';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';

describe('CreateWorkOrderUseCase', () => {
  let useCase: CreateWorkOrderUseCase;
  let mockRepos: jest.Mocked<IRepositories>;
  let mockUow: jest.Mocked<IUnitOfWork>;
  let metrics: jest.Mocked<IMetrics>;

  beforeEach(() => {
    const { unitOfWork, repos } = createMockUnitOfWorkWithRepos();
    mockRepos = repos;
    mockUow = unitOfWork;
    metrics = createMockMetrics();
    useCase = new CreateWorkOrderUseCase(mockUow, metrics);
  });

  it('should create a work order and initial status history', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const createdWO = createMockWorkOrder({ customerId: customer.id, vehicleId: vehicle.id });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.workOrder.generateNextNumber as jest.Mock).mockResolvedValue('000001');
    (mockRepos.workOrder.create as jest.Mock).mockResolvedValue(createdWO);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute({
      customerId: customer.id,
      vehicleId: vehicle.id,
      userId: randomUUID(),
    });

    expect(result).toBe(createdWO);
    expect(mockRepos.workOrder.create).toHaveBeenCalledTimes(1);
    expect(mockRepos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: WorkOrderStatus.RECEIVED }),
    );
  });

  it('should create a work order with assigned user (active mechanic)', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const userId = 'user-uuid';
    const user = { id: userId, name: 'John', role: UserRole.MECHANIC, isActive: true };
    const createdWO = createMockWorkOrder({
      customerId: customer.id,
      vehicleId: vehicle.id,
      assignedUserId: userId,
    });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.user.findById as jest.Mock).mockResolvedValue(user);
    (mockRepos.workOrder.generateNextNumber as jest.Mock).mockResolvedValue('000001');
    (mockRepos.workOrder.create as jest.Mock).mockResolvedValue(createdWO);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute({
      customerId: customer.id,
      vehicleId: vehicle.id,
      assignedUserId: userId,
      userId: randomUUID(),
    });

    expect(result).toBe(createdWO);
    expect(mockRepos.user.findById).toHaveBeenCalledWith(userId);
    expect(mockRepos.workOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({ assignedUserId: userId }),
    );
  });

  it('should throw BusinessRuleViolationException when assigned user is not a mechanic', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const user = { id: 'user-id', name: 'John', role: UserRole.ADMIN, isActive: true };

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.user.findById as jest.Mock).mockResolvedValue(user);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        assignedUserId: user.id,
        userId: randomUUID(),
      }),
    ).rejects.toThrow(BusinessRuleViolationException);
    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        assignedUserId: user.id,
        userId: randomUUID(),
      }),
    ).rejects.toThrow('Apenas mecânicos ativos podem ser atribuídos a uma ordem de serviço');
  });

  it('should throw BusinessRuleViolationException when assigned user is inactive', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const user = { id: 'user-id', name: 'John', role: UserRole.MECHANIC, isActive: false };

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.user.findById as jest.Mock).mockResolvedValue(user);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        assignedUserId: user.id,
        userId: randomUUID(),
      }),
    ).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should throw ResourceNotFoundException when user not found', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.user.findById as jest.Mock).mockResolvedValue(null);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        assignedUserId: 'bad-user',
        userId: randomUUID(),
      }),
    ).rejects.toThrow(ResourceNotFoundException);
  });

  it('should throw ResourceNotFoundException when customer not found', async () => {
    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(null);

    await expect(
      useCase.execute({ customerId: 'bad-id', vehicleId: 'any', userId: randomUUID() }),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(mockRepos.workOrder.create).not.toHaveBeenCalled();
  });

  it('should throw ResourceNotFoundException when vehicle not found', async () => {
    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(createMockCustomer());
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(null);

    await expect(
      useCase.execute({ customerId: 'c-id', vehicleId: 'bad-id', userId: randomUUID() }),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(mockRepos.workOrder.create).not.toHaveBeenCalled();
  });

  it('should set changedById to null when userId is not provided', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const createdWO = createMockWorkOrder({ customerId: customer.id, vehicleId: vehicle.id });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.workOrder.generateNextNumber as jest.Mock).mockResolvedValue('000001');
    (mockRepos.workOrder.create as jest.Mock).mockResolvedValue(createdWO);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    await useCase.execute({
      customerId: customer.id,
      vehicleId: vehicle.id,
      userId: undefined as unknown as string,
    });

    expect(mockRepos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ changedById: null }),
    );
  });

  it('should throw BusinessRuleViolationException when vehicle does not belong to customer', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: 'different-customer-id' });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);

    await expect(
      useCase.execute({ customerId: customer.id, vehicleId: vehicle.id, userId: randomUUID() }),
    ).rejects.toThrow();

    expect(mockRepos.workOrder.create).not.toHaveBeenCalled();
  });

  it('should create work order with inline services and persist quote via create', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const service = createMockService({ basePrice: 100 });
    const createdWO = createMockWorkOrder({ customerId: customer.id, vehicleId: vehicle.id });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.workOrder.generateNextNumber as jest.Mock).mockResolvedValue('000001');
    (mockRepos.workOrder.create as jest.Mock).mockResolvedValue(createdWO);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});
    (mockRepos.service.findByIds as jest.Mock).mockResolvedValue([service]);
    (mockRepos.quote.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute({
      customerId: customer.id,
      vehicleId: vehicle.id,
      userId: randomUUID(),
      services: [{ serviceId: service.id, quantity: 1 }],
    });

    expect(result).toBe(createdWO);
    expect(mockRepos.quote.create).toHaveBeenCalledTimes(1);
  });

  it('should create work order with services + parts via create', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const service = createMockService({ basePrice: 100 });
    const part = createMockPartSupply({ salePrice: 50 });
    const createdWO = createMockWorkOrder({ customerId: customer.id, vehicleId: vehicle.id });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.workOrder.generateNextNumber as jest.Mock).mockResolvedValue('000001');
    (mockRepos.workOrder.create as jest.Mock).mockResolvedValue(createdWO);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});
    (mockRepos.service.findByIds as jest.Mock).mockResolvedValue([service]);
    (mockRepos.partSupply.findByIds as jest.Mock).mockResolvedValue([part]);
    (mockRepos.quote.create as jest.Mock).mockResolvedValue({});

    await useCase.execute({
      customerId: customer.id,
      vehicleId: vehicle.id,
      userId: randomUUID(),
      services: [{ serviceId: service.id, quantity: 1 }],
      partsSupplies: [{ partSupplyId: part.id, quantity: 2 }],
    });

    expect(mockRepos.quote.create).toHaveBeenCalledTimes(1);
  });

  it('should NOT create a quote when no items are provided', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const createdWO = createMockWorkOrder({ customerId: customer.id, vehicleId: vehicle.id });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.workOrder.generateNextNumber as jest.Mock).mockResolvedValue('000001');
    (mockRepos.workOrder.create as jest.Mock).mockResolvedValue(createdWO);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    await useCase.execute({ customerId: customer.id, vehicleId: vehicle.id, userId: randomUUID() });

    expect(mockRepos.quote.create).not.toHaveBeenCalled();
  });

  it('should throw ResourceNotFoundException when inline service id is unknown — no write, no number consumed', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.service.findByIds as jest.Mock).mockResolvedValue([]);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
        services: [{ serviceId: 'unknown-id', quantity: 1 }],
      }),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(mockRepos.workOrder.generateNextNumber).not.toHaveBeenCalled();
    expect(mockRepos.workOrder.create).not.toHaveBeenCalled();
    expect(mockRepos.quote.create).not.toHaveBeenCalled();
  });

  it('should throw ResourceNotFoundException when inline part supply id is unknown — no write, no number consumed', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const service = createMockService({ basePrice: 100 });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
    (mockRepos.service.findByIds as jest.Mock).mockResolvedValue([service]);
    (mockRepos.partSupply.findByIds as jest.Mock).mockResolvedValue([]);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
        services: [{ serviceId: service.id, quantity: 1 }],
        partsSupplies: [{ partSupplyId: 'unknown-part-id', quantity: 1 }],
      }),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(mockRepos.workOrder.generateNextNumber).not.toHaveBeenCalled();
    expect(mockRepos.workOrder.create).not.toHaveBeenCalled();
    expect(mockRepos.quote.create).not.toHaveBeenCalled();
  });

  it('should throw BusinessRuleViolationException when only parts are provided (no service) — no write, no number consumed', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });
    const part = createMockPartSupply();

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
        partsSupplies: [{ partSupplyId: part.id, quantity: 1 }],
      }),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(mockRepos.workOrder.generateNextNumber).not.toHaveBeenCalled();
    expect(mockRepos.workOrder.create).not.toHaveBeenCalled();
    expect(mockRepos.quote.create).not.toHaveBeenCalled();
  });

  it('should reject creating a work order for an inactive customer', async () => {
    const customer = createMockCustomer();
    customer.deactivate();
    const vehicle = createMockVehicle({ customerId: customer.id });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);

    await expect(
      useCase.execute({ customerId: customer.id, vehicleId: vehicle.id, userId: randomUUID() }),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(mockRepos.workOrder.create).not.toHaveBeenCalled();
  });

  it('should throw BusinessRuleViolationException on duplicate service id — no resolution, no number consumed', async () => {
    const customer = createMockCustomer();
    const vehicle = createMockVehicle({ customerId: customer.id });

    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);

    await expect(
      useCase.execute({
        customerId: customer.id,
        vehicleId: vehicle.id,
        userId: randomUUID(),
        services: [
          { serviceId: 'duplicated-service-id', quantity: 1 },
          { serviceId: 'duplicated-service-id', quantity: 2 },
        ],
      }),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(mockRepos.service.findByIds).not.toHaveBeenCalled();
    expect(mockRepos.workOrder.generateNextNumber).not.toHaveBeenCalled();
    expect(mockRepos.workOrder.create).not.toHaveBeenCalled();
    expect(mockRepos.quote.create).not.toHaveBeenCalled();
  });
  describe('volume metric', () => {
    function arrangeHappyPath() {
      const customer = createMockCustomer();
      const vehicle = createMockVehicle({ customerId: customer.id });
      const createdWO = createMockWorkOrder({ customerId: customer.id, vehicleId: vehicle.id });

      (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
      (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
      (mockRepos.workOrder.generateNextNumber as jest.Mock).mockResolvedValue('000001');
      (mockRepos.workOrder.create as jest.Mock).mockResolvedValue(createdWO);
      (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

      return { customerId: customer.id, vehicleId: vehicle.id };
    }

    it('should count an actually created order exactly once', async () => {
      const { customerId, vehicleId } = arrangeHappyPath();

      await useCase.execute({ customerId, vehicleId, userId: randomUUID() });

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
      const customer = createMockCustomer();
      const vehicle = createMockVehicle({ customerId: customer.id });

      (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
      (mockRepos.vehicle.findById as jest.Mock).mockResolvedValue(vehicle);
      (mockRepos.workOrder.generateNextNumber as jest.Mock).mockResolvedValue('000001');
      (mockRepos.workOrder.create as jest.Mock).mockRejectedValue(new Error('rollback'));

      await expect(
        useCase.execute({ customerId: customer.id, vehicleId: vehicle.id, userId: randomUUID() }),
      ).rejects.toThrow('rollback');

      expect(metrics.increment).not.toHaveBeenCalled();
    });

    it('should emit only after the transaction returns', async () => {
      const { customerId, vehicleId } = arrangeHappyPath();
      const calls: string[] = [];

      (mockUow.executeTransaction as jest.Mock).mockImplementation(
        async (work: (repos: IRepositories) => Promise<unknown>) => {
          const result = await work(mockRepos);
          calls.push('commit');

          return result;
        },
      );
      metrics.increment.mockImplementation(() => {
        calls.push('increment');
      });

      await useCase.execute({ customerId, vehicleId, userId: randomUUID() });

      expect(calls).toEqual(['commit', 'increment']);
    });
  });
});
