import type { QuotePartSupply as PrismaQuotePartSupply } from '@generated/client';
import { QuotePartSupply } from '@domain/entities/quote-part-supply.entity';

export class QuotePartSupplyMapper {
  static toDomain(record: PrismaQuotePartSupply): QuotePartSupply {
    return QuotePartSupply.reconstitute({
      quoteId: record.quoteId,
      partSupplyId: record.partSupplyId,
      quantity: record.quantity,
      unitPrice: Number(record.unitPrice),
      totalPrice: Number(record.totalPrice),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
