import { WorkOrder } from '@domain/entities/work-order.entity';
import {
  PaginatedRepositoryResult,
  PaginationInput,
} from '@domain/interfaces/common/pagination.interface';
import {
  BillingQuoteGatewayResponse,
  BillingQuoteWithItemsGatewayResponse,
} from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';
import { BillingPaymentGatewayResponse } from '@application/ports/output/gateways/billing/billing-payments-gateway.response';
import { buildPaginationMeta } from '@application/utils/pagination.util';

import {
  MyWorkOrderResponse,
  MyWorkOrderDataResponse,
  MyWorkOrderPaginatedResponse,
  MyQuoteItemResponse,
  MyQuoteSummaryResponse,
  MyQuoteResponse,
  MyQuoteDataResponse,
  MyQuoteListResponse,
  MyPaymentListResponse,
} from './responses/me.response';

export class MePresenter {
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

  static toQuoteSummaryResponse(quote: BillingQuoteGatewayResponse): MyQuoteSummaryResponse {
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

  static toQuoteResponse(quote: BillingQuoteWithItemsGatewayResponse): MyQuoteResponse {
    const toItem = ({ id, name, quantity, unitPrice, totalPrice }: MyQuoteItemResponse) => ({
      id,
      name,
      quantity,
      unitPrice,
      totalPrice,
    });

    return {
      ...MePresenter.toQuoteSummaryResponse(quote),
      services: quote.services.map(toItem),
      partsSupplies: quote.partsSupplies.map(toItem),
    };
  }

  static toQuoteDataResponse(quote: BillingQuoteWithItemsGatewayResponse): MyQuoteDataResponse {
    return { data: MePresenter.toQuoteResponse(quote) };
  }

  static toQuoteListResponse(quotes: BillingQuoteGatewayResponse[]): MyQuoteListResponse {
    return { data: quotes.map((quote) => MePresenter.toQuoteSummaryResponse(quote)) };
  }

  static toPaymentListResponse(payments: BillingPaymentGatewayResponse[]): MyPaymentListResponse {
    return {
      data: payments.map(
        ({ id, amount, status, checkoutUrl, expiresAt, createdAt, updatedAt }) => ({
          id,
          amount,
          status,
          checkoutUrl,
          expiresAt,
          createdAt,
          updatedAt,
        }),
      ),
    };
  }
}
