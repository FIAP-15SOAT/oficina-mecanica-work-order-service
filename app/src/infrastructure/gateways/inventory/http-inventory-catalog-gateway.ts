import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import {
  InventoryPartSupplyGatewayResponse,
  InventoryServiceGatewayResponse,
} from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.response';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';

const NOT_FOUND_STATUS = 404;

@Injectable()
export class HttpInventoryCatalogGateway implements IInventoryCatalogGateway {
  private readonly baseUrl: string;

  constructor(
    private readonly internalHttpClient: InternalHttpClient,
    configService: ConfigService,
  ) {
    this.baseUrl = configService.getOrThrow<string>('INVENTORY_SERVICE_URL');
  }

  findServicesByIds(ids: readonly string[]): Promise<InventoryServiceGatewayResponse[]> {
    return this.findByIds<InventoryServiceGatewayResponse>('services', ids);
  }

  findPartsSuppliesByIds(ids: readonly string[]): Promise<InventoryPartSupplyGatewayResponse[]> {
    return this.findByIds<InventoryPartSupplyGatewayResponse>('parts-supplies', ids);
  }

  private async findByIds<T extends object>(
    resource: string,
    ids: readonly string[],
  ): Promise<T[]> {
    const found = await Promise.all(ids.map((id) => this.findById<T>(resource, id)));

    return found.filter((item) => item !== null);
  }

  private async findById<T>(resource: string, id: string): Promise<T | null> {
    try {
      const { data } = await this.internalHttpClient.request<{ data: T }>({
        method: 'GET',
        url: `${this.baseUrl}/internal/${resource}/${id}`,
      });

      return data;
    } catch (error) {
      if (!(error instanceof ServiceRequestRejectedException)) {
        throw error;
      }

      if (error.statusCode === NOT_FOUND_STATUS) {
        return null;
      }

      // Any other refusal means the two contracts drifted apart: the caller cannot fix the request.
      throw new ServiceIntegrationException('Serviço de destino indisponível');
    }
  }
}
