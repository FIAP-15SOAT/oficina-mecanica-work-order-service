import { CreateQuoteUseCase } from '@application/use-cases/quote/create-quote.use-case';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { createMockQuote } from '../../../../helpers/quote-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { QuoteItemValidator } from '@application/services/quote-item-validator';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import {
  createMockInventoryCatalogGateway,
  createMockInventoryPartSupplyGatewayResponse,
  createMockInventoryServiceGatewayResponse,
} from '../../../../helpers/inventory-catalog-gateway-mock.factory';

describe('CreateQuoteUseCase', () => {
  let useCase: CreateQuoteUseCase;
  let mockRepos: jest.Mocked<IRepositories>;
  let mockUnitOfWork: jest.Mocked<IUnitOfWork>;
  let inventoryCatalogGateway: jest.Mocked<IInventoryCatalogGateway>;

  beforeEach(() => {
    const { unitOfWork, repos } = createMockUnitOfWorkWithRepos();
    mockRepos = repos;
    mockUnitOfWork = unitOfWork;

    inventoryCatalogGateway = createMockInventoryCatalogGateway();

    useCase = new CreateQuoteUseCase(
      mockUnitOfWork,
      new QuoteItemValidator(inventoryCatalogGateway),
    );
  });

  it('should create an empty quote when WO is IN_DIAGNOSIS (no items)', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_DIAGNOSIS });
    const quote = createMockQuote({ workOrderId: workOrder.id });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.create as jest.Mock).mockResolvedValue(quote);

    const result = await useCase.execute({ workOrderId: workOrder.id });
    expect(result).toBe(quote);
    expect(mockRepos.quote.create).toHaveBeenCalledTimes(1);
  });

  it('should create a quote with items when services are provided', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_DIAGNOSIS });

    const service = createMockInventoryServiceGatewayResponse({ basePrice: 100 });

    const quote = createMockQuote({ workOrderId: workOrder.id });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([service]);
    (mockRepos.quote.create as jest.Mock).mockResolvedValue(quote);

    const result = await useCase.execute({
      workOrderId: workOrder.id,
      services: [{ serviceId: service.id, quantity: 1 }],
    });

    expect(result).toBe(quote);
    expect((mockRepos.quote.create as jest.Mock).mock.calls[0][0].totalAmount).toBe(100);
  });

  it('should answer 409 when creating a quote of a work order with a quote approval in progress', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });

    jest.mocked(mockRepos.workOrder.findById).mockResolvedValue(workOrder);

    jest.mocked(mockRepos.sagaInstance.hasActiveByWorkOrderId).mockResolvedValue(true);

    await expect(useCase.execute({ workOrderId: workOrder.id })).rejects.toThrow(
      new ResourceConflictException(
        'Ordem de serviço com aprovação de orçamento em andamento: aguarde a confirmação do estoque',
      ),
    );

    expect(mockRepos.sagaInstance.hasActiveByWorkOrderId).toHaveBeenCalledWith(workOrder.id);
    expect(mockRepos.quote.create).not.toHaveBeenCalled();
  });

  it('should reject parts-only payload (no service) with BusinessRuleViolationException', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_DIAGNOSIS });

    const part = createMockInventoryPartSupplyGatewayResponse();

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);

    await expect(
      useCase.execute({
        workOrderId: workOrder.id,
        partsSupplies: [{ partSupplyId: part.id, quantity: 1 }],
      }),
    ).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should answer 404 when the Inventory does not know the item', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_DIAGNOSIS });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([]);

    await expect(
      useCase.execute({
        workOrderId: workOrder.id,
        services: [{ serviceId: 'non-existent-id', quantity: 1 }],
      }),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(mockRepos.quote.create).not.toHaveBeenCalled();
  });

  it('should answer 503 and write nothing when the Inventory is unavailable', async () => {
    const unavailable = new ServiceIntegrationException('Serviço de destino indisponível');

    inventoryCatalogGateway.findServicesByIds.mockRejectedValue(unavailable);

    await expect(
      useCase.execute({
        workOrderId: createMockWorkOrder().id,
        services: [{ serviceId: 'service-id', quantity: 1 }],
      }),
    ).rejects.toBe(unavailable);

    expect(mockUnitOfWork.executeTransaction).not.toHaveBeenCalled();
  });

  it('should throw ResourceNotFoundException for unknown part id', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_DIAGNOSIS });
    const service = createMockInventoryServiceGatewayResponse();

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([service]);
    inventoryCatalogGateway.findPartsSuppliesByIds.mockResolvedValue([]);

    await expect(
      useCase.execute({
        workOrderId: workOrder.id,
        services: [{ serviceId: service.id, quantity: 1 }],
        partsSupplies: [{ partSupplyId: 'bad-part-id', quantity: 1 }],
      }),
    ).rejects.toThrow(ResourceNotFoundException);
  });

  it('should throw ResourceNotFoundException when WO not found', async () => {
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(null);

    await expect(useCase.execute({ workOrderId: 'bad-id' })).rejects.toThrow(
      ResourceNotFoundException,
    );
  });

  it('should throw BusinessRuleViolationException when WO is RECEIVED', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);

    await expect(useCase.execute({ workOrderId: workOrder.id })).rejects.toThrow(
      BusinessRuleViolationException,
    );
  });

  it('should create a quote when WO is AWAITING_APPROVAL', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });
    const quote = createMockQuote({ workOrderId: workOrder.id });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.create as jest.Mock).mockResolvedValue(quote);

    const result = await useCase.execute({ workOrderId: workOrder.id });
    expect(result).toBe(quote);
  });

  it('should throw BusinessRuleViolationException on duplicate service id — no resolution', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_DIAGNOSIS });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);

    await expect(
      useCase.execute({
        workOrderId: workOrder.id,
        services: [
          { serviceId: 'duplicated-service-id', quantity: 1 },
          { serviceId: 'duplicated-service-id', quantity: 2 },
        ],
      }),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(inventoryCatalogGateway.findServicesByIds).not.toHaveBeenCalled();
    expect(mockRepos.quote.create).not.toHaveBeenCalled();
  });
});
