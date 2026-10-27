import { WorkOrder } from '@domain/entities/work-order.entity';
import { Quote } from '@domain/entities/quote.entity';
import { CustomerType } from '@domain/enums/customer-type.enum';
import {
  PaginatedRepositoryResult,
  PaginationInput,
} from '@domain/interfaces/common/pagination.interface';
import { FindUserByIdOutput } from '@application/ports/input/user/find-user-by-id.use-case.interface';
import { buildPaginationMeta } from '@application/utils/pagination.util';

import {
  MeDataResponse,
  MyWorkOrderResponse,
  MyWorkOrderDataResponse,
  MyWorkOrderPaginatedResponse,
  MyQuoteSummaryResponse,
  MyQuoteResponse,
  MyQuoteDataResponse,
  MyQuoteListResponse,
} from './responses/me.response';

export class MePresenter {
  static toMeDataResponse(user: FindUserByIdOutput): MeDataResponse {
    return {
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        customers: user.customers
          .filter((customer) => customer.type === CustomerType.COMPANY)
          .map((customer) => ({ id: customer.id, name: customer.name, type: customer.type })),
      },
    };
  }

  static toWorkOrderResponse(workOrder: WorkOrder): MyWorkOrderResponse {
    return {
      id: workOrder.id,
      number: workOrder.number.toString(),
      status: workOrder.status,
      problemDescription: workOrder.problemDescription,
      mileageAtService: workOrder.mileageAtService,
      customer: {
        id: workOrder.customer!.id,
        name: workOrder.customer!.name,
        type: workOrder.customer!.type,
      },
      vehicle: workOrder.vehicle
        ? {
            id: workOrder.vehicle.id,
            plate: workOrder.vehicle.plate.value,
            brand: workOrder.vehicle.brand,
            model: workOrder.vehicle.model,
          }
        : null,
      createdAt: workOrder.createdAt,
      updatedAt: workOrder.updatedAt,
    };
  }

  static toWorkOrderDataResponse(workOrder: WorkOrder): MyWorkOrderDataResponse {
    return { data: MePresenter.toWorkOrderResponse(workOrder) };
  }

  static toWorkOrderPaginatedResponse(
    result: PaginatedRepositoryResult<WorkOrder>,
    pagination: PaginationInput,
  ): MyWorkOrderPaginatedResponse {
    return {
      data: result.items.map((item) => MePresenter.toWorkOrderResponse(item)),
      pagination: buildPaginationMeta(result.total, pagination),
    };
  }

  /** Summary — used in listings, where the items are not loaded. */
  static toQuoteSummaryResponse(quote: Quote): MyQuoteSummaryResponse {
    return {
      id: quote.id,
      status: quote.status,
      servicesAmount: quote.servicesAmount,
      partsAmount: quote.partsAmount,
      totalAmount: quote.totalAmount,
      notes: quote.notes,
      sentAt: quote.sentAt,
      approvedAt: quote.approvedAt,
      rejectedAt: quote.rejectedAt,
    };
  }

  /** Detail — requires a Quote loaded with findByIdWithDetails. */
  static toQuoteResponse(quote: Quote): MyQuoteResponse {
    return {
      ...MePresenter.toQuoteSummaryResponse(quote),
      services: quote.services.map((item) => ({
        id: item.serviceId,
        name: item.service!.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
      partsSupplies: quote.partsSupplies.map((item) => ({
        id: item.partSupplyId,
        name: item.partSupply!.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
    };
  }

  static toQuoteDataResponse(quote: Quote): MyQuoteDataResponse {
    return { data: MePresenter.toQuoteResponse(quote) };
  }

  static toQuoteListResponse(quotes: Quote[]): MyQuoteListResponse {
    return { data: quotes.map((quote) => MePresenter.toQuoteSummaryResponse(quote)) };
  }
}
