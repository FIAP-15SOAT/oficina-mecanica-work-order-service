import { UpdateStockUseCase } from '@application/use-cases/part-supply/update-stock.use-case';
import { randomUUID } from 'node:crypto';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { StockMovementType } from '@domain/enums/stock-movement-type.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { createMockPartSupply } from '../../../../helpers/part-supply-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { createMockStockMovement } from '../../../../helpers/stock-movement-mock.factory';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';

describe('UpdateStockUseCase', () => {
  let useCase: UpdateStockUseCase;
  let logger: jest.Mocked<ILogger>;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;

  beforeEach(() => {
    const uow = createMockUnitOfWorkWithRepos();
    unitOfWork = uow.unitOfWork;
    repos = uow.repos;
    logger = createMockLogger();
    useCase = new UpdateStockUseCase(unitOfWork, logger);
  });

  it('should register a Stock entry (ENTRY)', async () => {
    const id = randomUUID();
    const partSupply = createMockPartSupply({ id, stock: 10 });
    (repos.partSupply.findById as jest.Mock).mockResolvedValue(partSupply);
    (repos.partSupply.update as jest.Mock).mockResolvedValue(partSupply);
    (repos.stockMovement.create as jest.Mock).mockResolvedValue(createMockStockMovement());

    const result = await useCase.execute(id, {
      type: StockMovementType.ENTRY,
      quantity: 5,
      reason: 'Stock replenishment',
    });

    expect(repos.partSupply.update).toHaveBeenCalledWith(partSupply);
    expect(repos.stockMovement.create).toHaveBeenCalled();
    expect(result).toEqual(partSupply);
  });

  it('should register a Stock exit linked to a Work Order (EXIT) with workOrderId', async () => {
    const id = randomUUID();
    const workOrderId = randomUUID();
    const partSupply = createMockPartSupply({ id, stock: 10 });
    (repos.partSupply.findById as jest.Mock).mockResolvedValue(partSupply);
    (repos.partSupply.update as jest.Mock).mockResolvedValue(partSupply);
    (repos.stockMovement.create as jest.Mock).mockResolvedValue(createMockStockMovement());

    const result = await useCase.execute(id, {
      type: StockMovementType.EXIT,
      quantity: 3,
      reason: 'Work Order consumption',
      workOrderId,
    });

    expect(repos.partSupply.update).toHaveBeenCalledWith(partSupply);
    expect(repos.stockMovement.create).toHaveBeenCalled();
    expect(result).toEqual(partSupply);
  });

  it('should throw BusinessRuleViolationException when exit exceeds available stock', async () => {
    const id = randomUUID();
    (repos.partSupply.findById as jest.Mock).mockResolvedValue(
      createMockPartSupply({ id, stock: 10 }),
    );

    await expect(
      useCase.execute(id, {
        type: StockMovementType.EXIT,
        quantity: 15,
        workOrderId: randomUUID(),
      }),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(repos.partSupply.update).not.toHaveBeenCalled();
    expect(repos.stockMovement.create).not.toHaveBeenCalled();
  });

  it('should register a Stock adjustment (ADJUSTMENT) without a Work Order', async () => {
    const id = randomUUID();
    const partSupply = createMockPartSupply({ id, stock: 10 });
    (repos.partSupply.findById as jest.Mock).mockResolvedValue(partSupply);
    (repos.partSupply.update as jest.Mock).mockResolvedValue(partSupply);
    (repos.stockMovement.create as jest.Mock).mockResolvedValue(createMockStockMovement());

    const result = await useCase.execute(id, {
      type: StockMovementType.ADJUSTMENT,
      quantity: 8,
      reason: 'Physical inventory adjustment',
    });

    expect(repos.stockMovement.create).toHaveBeenCalled();
    expect(result).toEqual(partSupply);
  });

  it('should create stock movement with null reason when reason is not provided', async () => {
    const id = randomUUID();

    const partSupply = createMockPartSupply({ id, stock: 10 });
    (repos.partSupply.findById as jest.Mock).mockResolvedValue(partSupply);
    (repos.partSupply.update as jest.Mock).mockResolvedValue(partSupply);
    (repos.stockMovement.create as jest.Mock).mockResolvedValue(createMockStockMovement());

    await useCase.execute(id, {
      type: StockMovementType.ENTRY,
      quantity: 1,
    });

    const movementArg = (repos.stockMovement.create as jest.Mock).mock.calls[0][0];

    expect(movementArg.reason).toBeNull();
  });

  it('should throw ResourceNotFoundException when Part or Supply does not exist', async () => {
    (repos.partSupply.findById as jest.Mock).mockResolvedValue(null);

    await expect(
      useCase.execute('uuid-999', { type: StockMovementType.ENTRY, quantity: 1 }),
    ).rejects.toThrow(ResourceNotFoundException);
  });
});
