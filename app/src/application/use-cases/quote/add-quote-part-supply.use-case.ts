import { Quote } from '@domain/entities/quote.entity';
import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { AddQuotePartSupplyDto } from '@application/ports/input/quote/dto/add-quote-part-supply.dto';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { InventoryPartSupplyGatewayResponse } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.response';

export class AddQuotePartSupplyUseCase {
  constructor(
    private readonly quoteRepository: IQuoteRepository,
    private readonly unitOfWork: IUnitOfWork,
    private readonly inventoryCatalogGateway: IInventoryCatalogGateway,
  ) {}

  async execute(dto: AddQuotePartSupplyDto): Promise<Quote> {
    const quote = await this.quoteRepository.findByIdWithDetails(dto.quoteId);

    if (!quote) {
      throw new ResourceNotFoundException('Orçamento', dto.quoteId);
    }

    const partSupply = await this.findPartSupply(dto.partSupplyId);

    const item = quote.addPartSupply({
      partSupplyId: dto.partSupplyId,
      unitPrice: partSupply.salePrice,
      quantity: dto.quantity,
    });

    return this.unitOfWork.executeTransaction(async (repos) => {
      await repos.quote.addPartSupplyItem(item);
      return repos.quote.update(quote);
    });
  }

  private async findPartSupply(partSupplyId: string): Promise<InventoryPartSupplyGatewayResponse> {
    const [partSupply] = await this.inventoryCatalogGateway.findPartsSuppliesByIds([partSupplyId]);

    if (!partSupply) {
      throw new ResourceNotFoundException('Peça/Insumo', partSupplyId);
    }

    return partSupply;
  }
}
