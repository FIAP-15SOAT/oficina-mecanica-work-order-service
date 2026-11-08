import { FindWorkOrderQuotesUseCase } from '@application/use-cases/quote/find-work-order-quotes.use-case';

import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

import { Quote } from '@domain/entities/quote.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderNumber } from '@domain/value-objects/work-order-number.vo';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';

import { createMockQuoteRepository } from '../../../../helpers/quote-mock.factory';
import { createMockWorkOrderRepository } from '../../../../helpers/work-order-mock.factory';

describe('FindWorkOrderQuotesUseCase', () => {
  let useCase: FindWorkOrderQuotesUseCase;
  let quoteRepository: jest.Mocked<IQuoteRepository>;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;

  beforeEach(() => {
    quoteRepository = createMockQuoteRepository();
    workOrderRepository = createMockWorkOrderRepository();
    useCase = new FindWorkOrderQuotesUseCase(quoteRepository, workOrderRepository);
  });

  it('should return quotes for a work order', async () => {
    const workOrderId = 'wo-1';

    const workOrder = WorkOrder.reconstitute({
      id: 'wo-1',
      number: WorkOrderNumber.create('000001'),
      customerId: 'c1',
      vehicleId: 'v1',
      assignedUserId: null,
      status: WorkOrderStatus.RECEIVED,
      problemDescription: null,
      internalNotes: null,
      mileageAtService: null,
      totalAmount: 0,
      version: 0,
      approvedAt: null,
      rejectedAt: null,
      startedAt: null,
      finishedAt: null,
      deliveredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const quotes = [
      Quote.reconstitute({
        id: 'q1',
        workOrderId,
        status: QuoteStatus.PENDING,
        servicesAmount: 0,
        partsAmount: 0,
        totalAmount: 0,
        version: 0,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        replacedByQuoteId: null,
        decidedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      Quote.reconstitute({
        id: 'q2',
        workOrderId,
        status: QuoteStatus.SENT,
        servicesAmount: 0,
        partsAmount: 0,
        totalAmount: 0,
        version: 0,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        replacedByQuoteId: null,
        decidedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ];

    workOrderRepository.findById.mockResolvedValue(workOrder);
    quoteRepository.findByWorkOrderId.mockResolvedValue(quotes);

    const result = await useCase.execute(workOrderId);

    expect(result).toEqual(quotes);
    expect(workOrderRepository.findById).toHaveBeenCalledWith(workOrderId);
    expect(quoteRepository.findByWorkOrderId).toHaveBeenCalledWith(workOrderId);
  });

  it('should throw ResourceNotFoundException if work order not found', async () => {
    const workOrderId = 'invalid-wo';

    workOrderRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(workOrderId)).rejects.toThrow(ResourceNotFoundException);

    expect(quoteRepository.findByWorkOrderId).not.toHaveBeenCalled();
  });
});
