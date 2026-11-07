import { Quote } from '@domain/entities/quote.entity';
import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { AddQuoteServiceDto } from '@application/ports/input/quote/dto/add-quote-service.dto';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { InventoryServiceGatewayResponse } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.response';

export class AddQuoteServiceUseCase {
  constructor(
    private readonly quoteRepository: IQuoteRepository,
    private readonly unitOfWork: IUnitOfWork,
    private readonly inventoryCatalogGateway: IInventoryCatalogGateway,
  ) {}

  async execute(dto: AddQuoteServiceDto): Promise<Quote> {
    const quote = await this.quoteRepository.findByIdWithDetails(dto.quoteId);

    if (!quote) {
      throw new ResourceNotFoundException('Orçamento', dto.quoteId);
    }

    const service = await this.findService(dto.serviceId);

    const item = quote.addService({
      serviceId: dto.serviceId,
      unitPrice: service.basePrice,
      quantity: dto.quantity,
    });

    return this.unitOfWork.executeTransaction(async (repos) => {
      await repos.quote.addServiceItem(item);
      return repos.quote.update(quote);
    });
  }

  private async findService(serviceId: string): Promise<InventoryServiceGatewayResponse> {
    const [service] = await this.inventoryCatalogGateway.findServicesByIds([serviceId]);

    if (!service) {
      throw new ResourceNotFoundException('Serviço', serviceId);
    }

    return service;
  }
}
