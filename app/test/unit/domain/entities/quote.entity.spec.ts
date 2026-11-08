import { Quote } from '@domain/entities/quote.entity';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { QuoteService } from '@domain/entities/quote-service.entity';
import { QuotePartSupply } from '@domain/entities/quote-part-supply.entity';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { EntityNotFoundException } from '@domain/exceptions/entity-not-found.exception';
import { randomUUID } from 'node:crypto';

function makeQuote(
  status: QuoteStatus,
  opts?: {
    id?: string;
    services?: QuoteService[];
    partsSupplies?: QuotePartSupply[];
    servicesAmount?: number;
    partsAmount?: number;
    totalAmount?: number;
  },
): Quote {
  const now = new Date();

  return Quote.reconstitute({
    id: opts?.id ?? randomUUID(),
    workOrderId: '550e8400-e29b-41d4-a716-446655440111',
    servicesAmount: opts?.servicesAmount ?? 0,
    partsAmount: opts?.partsAmount ?? 0,
    totalAmount: opts?.totalAmount ?? 0,
    version: 0,
    status,
    notes: null,
    sentAt: null,
    approvedAt: null,
    rejectedAt: null,
    replacedByQuoteId: null,
    decidedBy: null,
    createdAt: now,
    updatedAt: now,
    services: opts?.services,
    partsSupplies: opts?.partsSupplies,
  });
}

describe('Quote Entity', () => {
  function makeService(unitPrice = 100): { serviceId: string; unitPrice: number } {
    return { serviceId: randomUUID(), unitPrice };
  }

  function makePartSupply(unitPrice = 50): { partSupplyId: string; unitPrice: number } {
    return { partSupplyId: randomUUID(), unitPrice };
  }

  describe('create()', () => {
    it('should create a quote with PENDING status and zero amounts', () => {
      const quote = Quote.create({ workOrderId: '550e8400-e29b-41d4-a716-446655440111' });

      expect(quote.id).toBeDefined();
      expect(quote.workOrderId).toBe('550e8400-e29b-41d4-a716-446655440111');
      expect(quote.status).toBe(QuoteStatus.PENDING);
      expect(quote.servicesAmount).toBe(0);
      expect(quote.partsAmount).toBe(0);
      expect(quote.totalAmount).toBe(0);
      expect(quote.notes).toBeNull();
      expect(quote.sentAt).toBeNull();
      expect(quote.approvedAt).toBeNull();
      expect(quote.rejectedAt).toBeNull();
    });

    it('should set notes when provided', () => {
      const quote = Quote.create({
        workOrderId: '550e8400-e29b-41d4-a716-446655440111',
        notes: 'Urgente',
      });
      expect(quote.notes).toBe('Urgente');
    });

    it('should throw when workOrderId is invalid', () => {
      expect(() => Quote.create({ workOrderId: 'invalid-id' })).toThrow(DomainValidationException);
    });

    it('should throw when workOrderId is empty', () => {
      expect(() => Quote.create({ workOrderId: '' })).toThrow(DomainValidationException);
    });

    it('should throw when notes exceed max length', () => {
      expect(() =>
        Quote.create({
          workOrderId: '550e8400-e29b-41d4-a716-446655440111',
          notes: 'N'.repeat(2001),
        }),
      ).toThrow(DomainValidationException);
    });

    it('should keep empty string when notes is only whitespace', () => {
      const quote = Quote.create({
        workOrderId: '550e8400-e29b-41d4-a716-446655440111',
        notes: '   ',
      });

      expect(quote.notes).toBe('');
    });

    it('should create with services only and compute totals', () => {
      const svc = makeService(200);
      const quote = Quote.create({
        workOrderId: '550e8400-e29b-41d4-a716-446655440111',
        services: [{ ...svc, quantity: 2 }],
      });

      expect(quote.services).toHaveLength(1);
      expect(quote.partsSupplies).toHaveLength(0);
      expect(quote.servicesAmount).toBe(400);
      expect(quote.partsAmount).toBe(0);
      expect(quote.totalAmount).toBe(400);
    });

    it('should create with services and parts and compute totals once', () => {
      const svc = makeService(100);
      const part = makePartSupply(50);
      const quote = Quote.create({
        workOrderId: '550e8400-e29b-41d4-a716-446655440111',
        services: [{ ...svc, quantity: 1 }],
        partsSupplies: [{ ...part, quantity: 3 }],
      });

      expect(quote.services).toHaveLength(1);
      expect(quote.partsSupplies).toHaveLength(1);
      expect(quote.servicesAmount).toBe(100);
      expect(quote.partsAmount).toBe(150);
      expect(quote.totalAmount).toBe(250);
    });

    it('should throw when parts are provided without a service', () => {
      const part = makePartSupply();
      expect(() =>
        Quote.create({
          workOrderId: '550e8400-e29b-41d4-a716-446655440111',
          partsSupplies: [{ ...part, quantity: 1 }],
        }),
      ).toThrow(BusinessRuleViolationException);
    });

    it('should throw on duplicate serviceId in the batch', () => {
      const svc = makeService();
      expect(() =>
        Quote.create({
          workOrderId: '550e8400-e29b-41d4-a716-446655440111',
          services: [
            { ...svc, quantity: 1 },
            { ...svc, quantity: 2 },
          ],
        }),
      ).toThrow(BusinessRuleViolationException);
    });

    it('should throw on duplicate partSupplyId in the batch', () => {
      const svc = makeService();
      const part = makePartSupply();
      expect(() =>
        Quote.create({
          workOrderId: '550e8400-e29b-41d4-a716-446655440111',
          services: [{ ...svc, quantity: 1 }],
          partsSupplies: [
            { ...part, quantity: 1 },
            { ...part, quantity: 2 },
          ],
        }),
      ).toThrow(BusinessRuleViolationException);
    });

    it('should create empty quote when no items are provided', () => {
      const quote = Quote.create({ workOrderId: '550e8400-e29b-41d4-a716-446655440111' });
      expect(quote.services).toHaveLength(0);
      expect(quote.partsSupplies).toHaveLength(0);
      expect(quote.totalAmount).toBe(0);
    });
  });

  describe('validateItems()', () => {
    it('should not throw when there are services and no parts', () => {
      expect(() => Quote.validateItems(['svc-1'], [])).not.toThrow();
    });

    it('should not throw when there are both services and parts', () => {
      expect(() =>
        Quote.validateItems(['svc-1', 'svc-2'], ['part-1', 'part-2', 'part-3']),
      ).not.toThrow();
    });

    it('should not throw when there are no items at all', () => {
      expect(() => Quote.validateItems([], [])).not.toThrow();
    });

    it('should throw BusinessRuleViolationException when there are parts but no services', () => {
      expect(() => Quote.validateItems([], ['part-1'])).toThrow(BusinessRuleViolationException);
    });

    it('should throw BusinessRuleViolationException on duplicate service ids', () => {
      expect(() => Quote.validateItems(['svc-1', 'svc-1'], [])).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should throw BusinessRuleViolationException on duplicate part supply ids', () => {
      expect(() => Quote.validateItems(['svc-1'], ['part-1', 'part-1'])).toThrow(
        BusinessRuleViolationException,
      );
    });
  });

  describe('approve()', () => {
    it('should throw when status is not SENT', () => {
      const quote = makeQuote(QuoteStatus.PENDING);
      expect(() => quote.approve(null)).toThrow(BusinessRuleViolationException);
    });

    it('should keep the decision author on approval', () => {
      const decidedBy = randomUUID();
      const quote = makeQuote(QuoteStatus.SENT);

      quote.approve(decidedBy);

      expect(quote.status).toBe(QuoteStatus.APPROVED);
      expect(quote.approvedAt).toBeInstanceOf(Date);
      expect(quote.decidedBy).toBe(decidedBy);
    });
  });

  describe('rejectByApprovalOf()', () => {
    it.each([QuoteStatus.PENDING, QuoteStatus.SENT])(
      'should reject a %s quote replaced by an approved one',
      (status) => {
        const approvedQuoteId = randomUUID();
        const quote = makeQuote(status);

        quote.rejectByApprovalOf(approvedQuoteId);

        expect(quote.status).toBe(QuoteStatus.REJECTED);
        expect(quote.replacedByQuoteId).toBe(approvedQuoteId);
        expect(quote.rejectedAt).toBeInstanceOf(Date);
        expect(quote.decidedBy).toBeNull();
      },
    );

    it.each([QuoteStatus.APPROVED, QuoteStatus.REJECTED])(
      'should refuse to reject a quote in %s as replaced',
      (status) => {
        const quote = makeQuote(status);

        expect(() => quote.rejectByApprovalOf(randomUUID())).toThrow(
          new BusinessRuleViolationException(
            `Orçamento só pode ser rejeitado pela aprovação de outro se estiver no status PENDING ou SENT. Status atual: "${status}"`,
          ),
        );
      },
    );
  });

  describe('reject()', () => {
    it('should set status to REJECTED and set rejectedAt', () => {
      const quote = makeQuote(QuoteStatus.SENT);
      quote.reject();

      expect(quote.status).toBe(QuoteStatus.REJECTED);
      expect(quote.rejectedAt).toBeInstanceOf(Date);
    });

    it('should throw when status is not SENT', () => {
      const quote = makeQuote(QuoteStatus.APPROVED);
      expect(() => quote.reject()).toThrow(BusinessRuleViolationException);
    });
  });

  describe('submit()', () => {
    it('should set status to SENT and set sentAt when PENDING with a service', () => {
      const quote = makeQuote(QuoteStatus.PENDING, {
        services: [{ totalPrice: 100 } as QuoteService],
      });

      quote.submit();

      expect(quote.status).toBe(QuoteStatus.SENT);
      expect(quote.sentAt).toBeInstanceOf(Date);
      expect(quote.updatedAt).toBeInstanceOf(Date);
    });

    it('should throw when not PENDING', () => {
      const quote = makeQuote(QuoteStatus.SENT, {
        services: [{ totalPrice: 100 } as QuoteService],
      });

      expect(() => quote.submit()).toThrow(BusinessRuleViolationException);
    });

    it('should throw when quote has no items (empty)', () => {
      const quote = makeQuote(QuoteStatus.PENDING);
      expect(() => quote.submit()).toThrow(BusinessRuleViolationException);
    });

    it('should throw when quote has only parts and no service', () => {
      const partSupplyId = randomUUID();
      const quoteId = randomUUID();
      const item = QuotePartSupply.reconstitute({
        quoteId,
        partSupplyId,
        quantity: 1,
        unitPrice: 50,
        totalPrice: 50,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const quote = makeQuote(QuoteStatus.PENDING, { id: quoteId, partsSupplies: [item] });
      expect(() => quote.submit()).toThrow(BusinessRuleViolationException);
    });
  });

  describe('addService()', () => {
    it('should add a service and recalculate totals', () => {
      const quote = makeQuote(QuoteStatus.PENDING);
      const service = makeService(200);

      const item = quote.addService({ ...service, quantity: 2 });

      expect(item.serviceId).toBe(service.serviceId);
      expect(item.totalPrice).toBe(400);
      expect(quote.services).toHaveLength(1);
      expect(quote.servicesAmount).toBe(400);
      expect(quote.totalAmount).toBe(400);
    });

    it('should throw when quote is not PENDING', () => {
      const quote = makeQuote(QuoteStatus.SENT, { services: [] });
      const service = makeService();

      expect(() => quote.addService({ ...service, quantity: 1 })).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should throw when service already added', () => {
      const service = makeService();
      const existing = QuoteService.reconstitute({
        quoteId: randomUUID(),
        serviceId: service.serviceId,
        quantity: 1,
        unitPrice: 100,
        totalPrice: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const quote = makeQuote(QuoteStatus.PENDING, { services: [existing] });

      expect(() => quote.addService({ ...service, quantity: 1 })).toThrow(
        BusinessRuleViolationException,
      );
    });
  });

  describe('removeService()', () => {
    it('should remove the service and recalculate totals', () => {
      const service = makeService();
      const quoteId = randomUUID();

      const item = QuoteService.reconstitute({
        quoteId,
        serviceId: service.serviceId,
        quantity: 1,
        unitPrice: 150,
        totalPrice: 150,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const quote = makeQuote(QuoteStatus.PENDING, { id: quoteId, services: [item] });

      quote.removeService(service.serviceId);

      expect(quote.services).toHaveLength(0);
      expect(quote.servicesAmount).toBe(0);
    });

    it('should throw when quote is not PENDING', () => {
      const quote = makeQuote(QuoteStatus.SENT, { services: [] });
      expect(() => quote.removeService(randomUUID())).toThrow(BusinessRuleViolationException);
    });

    it('should throw EntityNotFoundException when service not in quote', () => {
      const quote = makeQuote(QuoteStatus.PENDING);
      expect(() => quote.removeService(randomUUID())).toThrow(EntityNotFoundException);
    });
  });

  describe('updateServiceQuantity()', () => {
    it('should update quantity and recalculate totals', () => {
      const serviceId = randomUUID();
      const quoteId = randomUUID();
      const item = QuoteService.reconstitute({
        quoteId,
        serviceId,
        quantity: 1,
        unitPrice: 100,
        totalPrice: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const quote = makeQuote(QuoteStatus.PENDING, { id: quoteId, services: [item] });

      quote.updateServiceQuantity(serviceId, 3);

      expect(item.quantity).toBe(3);
      expect(item.totalPrice).toBe(300);
      expect(quote.servicesAmount).toBe(300);
    });

    it('should throw EntityNotFoundException when service not in quote', () => {
      const quote = makeQuote(QuoteStatus.PENDING);
      expect(() => quote.updateServiceQuantity(randomUUID(), 2)).toThrow(EntityNotFoundException);
    });

    it('should throw when quote is not PENDING', () => {
      const quote = makeQuote(QuoteStatus.SENT, { services: [] });
      expect(() => quote.updateServiceQuantity(randomUUID(), 2)).toThrow(
        BusinessRuleViolationException,
      );
    });
  });

  describe('addPartSupply()', () => {
    it('should add a part supply and recalculate totals', () => {
      const quote = makeQuote(QuoteStatus.PENDING);
      const part = makePartSupply(50);

      const item = quote.addPartSupply({ ...part, quantity: 3 });

      expect(item.partSupplyId).toBe(part.partSupplyId);
      expect(item.totalPrice).toBe(150);
      expect(quote.partsSupplies).toHaveLength(1);
      expect(quote.partsAmount).toBe(150);
    });

    it('should throw when quote is not PENDING', () => {
      const quote = makeQuote(QuoteStatus.APPROVED, { partsSupplies: [] });
      const part = makePartSupply();

      expect(() => quote.addPartSupply({ ...part, quantity: 1 })).toThrow(
        BusinessRuleViolationException,
      );
    });

    it('should throw when part supply already added', () => {
      const part = makePartSupply();
      const existing = QuotePartSupply.reconstitute({
        quoteId: randomUUID(),
        partSupplyId: part.partSupplyId,
        quantity: 1,
        unitPrice: 50,
        totalPrice: 50,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const quote = makeQuote(QuoteStatus.PENDING, { partsSupplies: [existing] });

      expect(() => quote.addPartSupply({ ...part, quantity: 1 })).toThrow(
        BusinessRuleViolationException,
      );
    });
  });

  describe('removePartSupply()', () => {
    it('should remove the part supply and recalculate totals', () => {
      const partSupplyId = randomUUID();
      const quoteId = randomUUID();
      const item = QuotePartSupply.reconstitute({
        quoteId,
        partSupplyId,
        quantity: 2,
        unitPrice: 50,
        totalPrice: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const quote = makeQuote(QuoteStatus.PENDING, { id: quoteId, partsSupplies: [item] });

      quote.removePartSupply(partSupplyId);

      expect(quote.partsSupplies).toHaveLength(0);
      expect(quote.partsAmount).toBe(0);
    });

    it('should throw EntityNotFoundException when part not in quote', () => {
      const quote = makeQuote(QuoteStatus.PENDING);
      expect(() => quote.removePartSupply(randomUUID())).toThrow(EntityNotFoundException);
    });

    it('should throw when quote is not PENDING', () => {
      const quote = makeQuote(QuoteStatus.SENT, { partsSupplies: [] });
      expect(() => quote.removePartSupply(randomUUID())).toThrow(BusinessRuleViolationException);
    });
  });

  describe('updatePartSupplyQuantity()', () => {
    it('should update quantity and recalculate totals', () => {
      const partSupplyId = randomUUID();
      const quoteId = randomUUID();
      const item = QuotePartSupply.reconstitute({
        quoteId,
        partSupplyId,
        quantity: 1,
        unitPrice: 80,
        totalPrice: 80,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const quote = makeQuote(QuoteStatus.PENDING, { id: quoteId, partsSupplies: [item] });

      quote.updatePartSupplyQuantity(partSupplyId, 4);

      expect(item.quantity).toBe(4);
      expect(item.totalPrice).toBe(320);
      expect(quote.partsAmount).toBe(320);
    });

    it('should throw EntityNotFoundException when part not in quote', () => {
      const quote = makeQuote(QuoteStatus.PENDING);
      expect(() => quote.updatePartSupplyQuantity(randomUUID(), 2)).toThrow(
        EntityNotFoundException,
      );
    });

    it('should throw when quote is not PENDING', () => {
      const quote = makeQuote(QuoteStatus.SENT, { partsSupplies: [] });
      expect(() => quote.updatePartSupplyQuantity(randomUUID(), 2)).toThrow(
        BusinessRuleViolationException,
      );
    });
  });
});
