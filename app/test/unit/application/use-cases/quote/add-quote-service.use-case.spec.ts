import { AddQuoteServiceUseCase } from '@application/use-cases/quote/add-quote-service.use-case';
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
  createMockQuoteService,
} from '../../../../helpers/quote-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import {
  createMockInventoryCatalogGateway,
  createMockInventoryServiceGatewayResponse,
} from '../../../../helpers/inventory-catalog-gateway-mock.factory';

describe('AddQuoteServiceUseCase', () => {
  let useCase: AddQuoteServiceUseCase;
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

    useCase = new AddQuoteServiceUseCase(quoteRepository, unitOfWork, inventoryCatalogGateway);
  });

  it('should add the service with the Inventory base price and recalculate the totals', async () => {
    const quote = createMockQuote({ status: QuoteStatus.PENDING, services: [] });

    const service = createMockInventoryServiceGatewayResponse({ basePrice: 150 });

    quoteRepository.findByIdWithDetails.mockResolvedValue(quote);
    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([service]);

    const result = await useCase.execute({ quoteId: quote.id, serviceId: service.id, quantity: 1 });

    expect(inventoryCatalogGateway.findServicesByIds).toHaveBeenCalledWith([service.id]);
    expect(transactionQuoteRepository.addServiceItem).toHaveBeenCalledTimes(1);
    expect(transactionQuoteRepository.update).toHaveBeenCalledWith(quote);
    expect(result.servicesAmount).toBe(150);
  });

  it('should answer 404 for an unknown quote before reading the Inventory', async () => {
    quoteRepository.findByIdWithDetails.mockResolvedValue(null);

    await expect(
      useCase.execute({ quoteId: 'unknown-id', serviceId: 'any', quantity: 1 }),
    ).rejects.toThrow(new ResourceNotFoundException('Orçamento', 'unknown-id'));

    expect(inventoryCatalogGateway.findServicesByIds).not.toHaveBeenCalled();
  });

  it('should answer 404 when the Inventory does not know the item', async () => {
    quoteRepository.findByIdWithDetails.mockResolvedValue(
      createMockQuote({ status: QuoteStatus.PENDING, services: [] }),
    );

    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([]);

    await expect(
      useCase.execute({ quoteId: 'quote-id', serviceId: 'unknown-id', quantity: 1 }),
    ).rejects.toThrow(new ResourceNotFoundException('Serviço', 'unknown-id'));

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
  });

  it('should answer 503 and write nothing when the Inventory is unavailable', async () => {
    const unavailable = new ServiceIntegrationException('Serviço de destino indisponível');

    quoteRepository.findByIdWithDetails.mockResolvedValue(
      createMockQuote({ status: QuoteStatus.PENDING, services: [] }),
    );
    inventoryCatalogGateway.findServicesByIds.mockRejectedValue(unavailable);

    await expect(
      useCase.execute({ quoteId: 'quote-id', serviceId: 'service-id', quantity: 1 }),
    ).rejects.toBe(unavailable);

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
  });

  it('should throw BusinessRuleViolationException when quote is not PENDING', async () => {
    const service = createMockInventoryServiceGatewayResponse();

    quoteRepository.findByIdWithDetails.mockResolvedValue(
      createMockQuote({ status: QuoteStatus.SENT, services: [] }),
    );
    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([service]);

    await expect(
      useCase.execute({ quoteId: 'quote-id', serviceId: service.id, quantity: 1 }),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(transactionQuoteRepository.addServiceItem).not.toHaveBeenCalled();
    expect(transactionQuoteRepository.update).not.toHaveBeenCalled();
  });

  it('should throw BusinessRuleViolationException when service already exists in quote', async () => {
    const service = createMockInventoryServiceGatewayResponse();
    const existing = createMockQuoteService({ serviceId: service.id });

    quoteRepository.findByIdWithDetails.mockResolvedValue(
      createMockQuote({ status: QuoteStatus.PENDING, services: [existing] }),
    );
    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([service]);

    await expect(
      useCase.execute({ quoteId: 'quote-id', serviceId: service.id, quantity: 1 }),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(transactionQuoteRepository.addServiceItem).not.toHaveBeenCalled();
    expect(transactionQuoteRepository.update).not.toHaveBeenCalled();
  });
});
