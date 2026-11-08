import { Quote } from '@domain/entities/quote.entity';
import { QuoteService } from '@domain/entities/quote-service.entity';
import { QuotePartSupply } from '@domain/entities/quote-part-supply.entity';
import { PaginatedResult } from '@domain/interfaces/common/pagination.interface';
import { FindCatalogItemsOutputDto } from '@application/ports/input/catalog/dto/find-catalog-items.dto';
import {
  InventoryPartSupplyGatewayResponse,
  InventoryServiceGatewayResponse,
} from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.response';
import { WorkOrderPresenter } from '@interface-adapters/work-order/work-order.presenter';

import {
  QuoteResponse,
  QuoteListResponse,
  QuotePaginatedResponse,
  QuoteDataResponse,
  QuoteWithItemsDataResponse,
  QuoteWithItemsResponse,
  QuoteServiceItemResponse,
  QuotePartSupplyItemResponse,
} from './responses/quote.response';
import { InternalQuoteUsageDataResponse } from './responses/internal-quote.response';

export class QuotePresenter {
  static toResponse(quote: Quote): QuoteResponse {
    return {
      id: quote.id,
      workOrder: WorkOrderPresenter.toSummaryResponse(quote.workOrder!),
      status: quote.status,
      notes: quote.notes,
      sentAt: quote.sentAt,
      approvedAt: quote.approvedAt,
      rejectedAt: quote.rejectedAt,
      servicesAmount: quote.servicesAmount,
      partsAmount: quote.partsAmount,
      totalAmount: quote.totalAmount,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    };
  }

  static toWithItemsResponse(
    quote: Quote,
    catalog: FindCatalogItemsOutputDto,
  ): QuoteWithItemsDataResponse {
    return {
      data: QuotePresenter.toWithItemsDto(quote, catalog),
    };
  }

  private static toWithItemsDto(
    quote: Quote,
    catalog: FindCatalogItemsOutputDto,
  ): QuoteWithItemsResponse {
    return {
      ...QuotePresenter.toResponse(quote),
      services: quote.services.map((item) =>
        QuotePresenter.toServiceItem(
          item,
          catalog.services.find((service) => service.id === item.serviceId),
        ),
      ),
      partsSupplies: quote.partsSupplies.map((item) =>
        QuotePresenter.toPartSupplyItem(
          item,
          catalog.partsSupplies.find((partSupply) => partSupply.id === item.partSupplyId),
        ),
      ),
    };
  }

  private static toServiceItem(
    item: QuoteService,
    service: InventoryServiceGatewayResponse | undefined,
  ): QuoteServiceItemResponse {
    return {
      id: item.serviceId,
      name: service?.name ?? null,
      description: service?.description ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private static toPartSupplyItem(
    item: QuotePartSupply,
    partSupply: InventoryPartSupplyGatewayResponse | undefined,
  ): QuotePartSupplyItemResponse {
    return {
      id: item.partSupplyId,
      name: partSupply?.name ?? null,
      description: partSupply?.description ?? null,
      sku: partSupply?.sku ?? null,
      partNumber: partSupply?.partNumber ?? null,
      category: partSupply?.category ?? null,
      unit: partSupply?.unit ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toDataResponse(quote: Quote): QuoteDataResponse {
    return { data: QuotePresenter.toResponse(quote) };
  }

  static toListResponse(quotes: Quote[]): QuoteListResponse {
    return {
      data: quotes.map((q) => QuotePresenter.toResponse(q)),
    };
  }

  static toPaginatedResponse(paginatedResult: PaginatedResult<Quote>): QuotePaginatedResponse {
    const { items, pagination } = paginatedResult;
    return {
      data: items.map((q) => QuotePresenter.toResponse(q)),
      pagination,
    };
  }

  static toInternalUsageDataResponse(inUse: boolean): InternalQuoteUsageDataResponse {
    return { data: { inUse } };
  }
}
