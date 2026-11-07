import type { QuoteService as PrismaQuoteService } from '@generated/client';
import { QuoteService } from '@domain/entities/quote-service.entity';

export class QuoteServiceMapper {
  static toDomain(record: PrismaQuoteService): QuoteService {
    return QuoteService.reconstitute({
      quoteId: record.quoteId,
      serviceId: record.serviceId,
      quantity: record.quantity,
      unitPrice: Number(record.unitPrice),
      totalPrice: Number(record.totalPrice),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
