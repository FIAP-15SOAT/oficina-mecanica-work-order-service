import {
  Quote,
  CreateQuoteItemServiceProps,
  CreateQuoteItemPartSupplyProps,
} from '@domain/entities/quote.entity';

import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';

interface ServiceInput {
  serviceId: string;
  quantity: number;
}

interface PartSupplyInput {
  partSupplyId: string;
  quantity: number;
}

export class QuoteItemValidator {
  constructor(private readonly inventoryCatalogGateway: IInventoryCatalogGateway) {}

  async validateAndResolve(
    serviceInputs: ServiceInput[],
    partSupplyInputs: PartSupplyInput[],
  ): Promise<{
    services: CreateQuoteItemServiceProps[];
    partsSupplies: CreateQuoteItemPartSupplyProps[];
  }> {
    Quote.validateItems(
      serviceInputs.map((input) => input.serviceId),
      partSupplyInputs.map((input) => input.partSupplyId),
    );

    const [services, partsSupplies] = await Promise.all([
      this.resolveServiceItems(serviceInputs),
      this.resolvePartSupplyItems(partSupplyInputs),
    ]);

    return { services, partsSupplies };
  }

  private async resolveServiceItems(
    inputs: ServiceInput[],
  ): Promise<CreateQuoteItemServiceProps[]> {
    const services = await this.resolveExisting(
      inputs.map((input) => input.serviceId),
      (ids) => this.inventoryCatalogGateway.findServicesByIds(ids),
      'Serviço',
    );

    return inputs.map((input, index) => ({
      serviceId: input.serviceId,
      unitPrice: services[index].basePrice,
      quantity: input.quantity,
    }));
  }

  private async resolvePartSupplyItems(
    inputs: PartSupplyInput[],
  ): Promise<CreateQuoteItemPartSupplyProps[]> {
    const partsSupplies = await this.resolveExisting(
      inputs.map((input) => input.partSupplyId),
      (ids) => this.inventoryCatalogGateway.findPartsSuppliesByIds(ids),
      'Peça/Insumo',
    );

    return inputs.map((input, index) => ({
      partSupplyId: input.partSupplyId,
      unitPrice: partsSupplies[index].salePrice,
      quantity: input.quantity,
    }));
  }

  private async resolveExisting<T extends { id: string }>(
    ids: string[],
    findByIds: (ids: string[]) => Promise<T[]>,
    resourceName: string,
  ): Promise<T[]> {
    if (ids.length === 0) return [];

    const found = await findByIds(ids);
    const byId = new Map(found.map((item): [string, T] => [item.id, item]));

    return ids.map((id) => {
      const item = byId.get(id);

      if (!item) {
        throw new ResourceNotFoundException(resourceName, id);
      }

      return item;
    });
  }
}
