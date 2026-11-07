import { AddQuotePartSupplyUseCase } from '@application/use-cases/quote/add-quote-part-supply.use-case';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import {
  createMockQuote,
  createMockQuoteRepository,
  createMockQuotePartSupply,
} from '../../../../helpers/quote-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import {
  createMockInventoryCatalogGateway,
  createMockInventoryPartSupplyGatewayResponse,
} from '../../../../helpers/inventory-catalog-gateway-mock.factory';

describe('AddQuotePartSupplyUseCase', () => {
  let useCase: AddQuotePartSupplyUseCase;
  let quoteRepository: jest.Mocked<IQuoteRepository>;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let transactionQuoteRepository: jest.Mocked<IQuoteRepository>;
  let inventoryCatalogGateway: jest.Mocked<IInventoryCatalogGateway>;

  beforeEach(() => {
    const mock = createMockUnitOfWorkWithRepos();
    unitOfWork = mock.unitOfWork;

    transactionQuoteRepository = mock.repos.quote as jest.Mocked<IQuoteRepository>;
    transactionQuoteRepository.update.mockImplementation((quote) => Promise.resolve(quote));

    quoteRepository = createMockQuoteRepository();

    inventoryCatalogGateway = createMockInventoryCatalogGateway();

    useCase = new AddQuotePartSupplyUseCase(quoteRepository, unitOfWork, inventoryCatalogGateway);
  });

  it('should add the part supply with the Inventory sale price and recalculate the totals', async () => {
    const quote = createMockQuote({ status: QuoteStatus.PENDING, partsSupplies: [] });
    const partSupply = createMockInventoryPartSupplyGatewayResponse({ salePrice: 80 });

    quoteRepository.findByIdWithDetails.mockResolvedValue(quote);
    inventoryCatalogGateway.findPartsSuppliesByIds.mockResolvedValue([partSupply]);

    const result = await useCase.execute({
      quoteId: quote.id,
      partSupplyId: partSupply.id,
      quantity: 2,
    });

    expect(inventoryCatalogGateway.findPartsSuppliesByIds).toHaveBeenCalledWith([partSupply.id]);
    expect(transactionQuoteRepository.addPartSupplyItem).toHaveBeenCalledTimes(1);
    expect(transactionQuoteRepository.update).toHaveBeenCalledWith(quote);
    expect(result.partsAmount).toBe(160);
  });

  it('should answer 404 for an unknown quote before reading the Inventory', async () => {
    quoteRepository.findByIdWithDetails.mockResolvedValue(null);

    await expect(
      useCase.execute({ quoteId: 'unknown-id', partSupplyId: 'any', quantity: 1 }),
    ).rejects.toThrow(new ResourceNotFoundException('Orçamento', 'unknown-id'));

    expect(inventoryCatalogGateway.findPartsSuppliesByIds).not.toHaveBeenCalled();
  });

  it('should answer 404 when the Inventory does not know the item', async () => {
    quoteRepository.findByIdWithDetails.mockResolvedValue(
      createMockQuote({ status: QuoteStatus.PENDING, partsSupplies: [] }),
    );
    inventoryCatalogGateway.findPartsSuppliesByIds.mockResolvedValue([]);

    await expect(
      useCase.execute({ quoteId: 'quote-id', partSupplyId: 'unknown-id', quantity: 1 }),
    ).rejects.toThrow(new ResourceNotFoundException('Peça/Insumo', 'unknown-id'));

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
  });

  it('should answer 503 and write nothing when the Inventory is unavailable', async () => {
    const unavailable = new ServiceIntegrationException('Serviço de destino indisponível');

    quoteRepository.findByIdWithDetails.mockResolvedValue(
      createMockQuote({ status: QuoteStatus.PENDING, partsSupplies: [] }),
    );
    inventoryCatalogGateway.findPartsSuppliesByIds.mockRejectedValue(unavailable);

    await expect(
      useCase.execute({ quoteId: 'quote-id', partSupplyId: 'part-supply-id', quantity: 1 }),
    ).rejects.toBe(unavailable);

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
  });

  it('should throw BusinessRuleViolationException when quote is not PENDING', async () => {
    const partSupply = createMockInventoryPartSupplyGatewayResponse();

    quoteRepository.findByIdWithDetails.mockResolvedValue(
      createMockQuote({ status: QuoteStatus.APPROVED, partsSupplies: [] }),
    );
    inventoryCatalogGateway.findPartsSuppliesByIds.mockResolvedValue([partSupply]);

    await expect(
      useCase.execute({ quoteId: 'quote-id', partSupplyId: partSupply.id, quantity: 1 }),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(transactionQuoteRepository.addPartSupplyItem).not.toHaveBeenCalled();
    expect(transactionQuoteRepository.update).not.toHaveBeenCalled();
  });

  it('should throw BusinessRuleViolationException when part supply already exists in quote', async () => {
    const partSupply = createMockInventoryPartSupplyGatewayResponse();
    const existing = createMockQuotePartSupply({ partSupplyId: partSupply.id });

    quoteRepository.findByIdWithDetails.mockResolvedValue(
      createMockQuote({ status: QuoteStatus.PENDING, partsSupplies: [existing] }),
    );
    inventoryCatalogGateway.findPartsSuppliesByIds.mockResolvedValue([partSupply]);

    await expect(
      useCase.execute({ quoteId: 'quote-id', partSupplyId: partSupply.id, quantity: 1 }),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(transactionQuoteRepository.addPartSupplyItem).not.toHaveBeenCalled();
    expect(transactionQuoteRepository.update).not.toHaveBeenCalled();
  });
});
