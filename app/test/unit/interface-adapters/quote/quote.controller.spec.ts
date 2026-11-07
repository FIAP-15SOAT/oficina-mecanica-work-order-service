import { randomUUID } from 'node:crypto';

import { QuoteController } from '@interface-adapters/quote/quote.controller';
import { QuotePresenter } from '@interface-adapters/quote/quote.presenter';
import { UpdateQuoteStatusRequest } from '@interface-adapters/quote/requests/update-quote-status-request';

import { Quote } from '@domain/entities/quote.entity';
import { QuoteStatus } from '@domain/enums/quote-status.enum';

import { ICreateQuoteUseCase } from '@application/ports/input/quote/create-quote.use-case.interface';
import { IFindQuoteByIdUseCase } from '@application/ports/input/quote/find-quote-by-id.use-case.interface';
import { IAddQuoteServiceUseCase } from '@application/ports/input/quote/add-quote-service.use-case.interface';
import { IRemoveQuoteServiceUseCase } from '@application/ports/input/quote/remove-quote-service.use-case.interface';
import { IAddQuotePartSupplyUseCase } from '@application/ports/input/quote/add-quote-part-supply.use-case.interface';
import { IRemoveQuotePartSupplyUseCase } from '@application/ports/input/quote/remove-quote-part-supply.use-case.interface';
import { IUpdateQuoteServiceQuantityUseCase } from '@application/ports/input/quote/update-quote-service-quantity.use-case.interface';
import { IUpdateQuotePartSupplyQuantityUseCase } from '@application/ports/input/quote/update-quote-part-supply-quantity.use-case.interface';
import { ISubmitQuoteUseCase } from '@application/ports/input/quote/submit-quote.use-case.interface';
import { IUpdateQuoteStatusUseCase } from '@application/ports/input/quote/update-quote-status.use-case.interface';
import { IFindAllQuotesPaginatedUseCase } from '@application/ports/input/quote/find-all-quotes-paginated.use-case.interface';
import { IFindCatalogItemsUseCase } from '@application/ports/input/catalog/find-catalog-items.use-case.interface';

import {
  createMockQuote,
  createMockQuotePartSupply,
  createMockQuoteService,
} from '../../../helpers/quote-mock.factory';
import {
  createMockInventoryPartSupplyGatewayResponse,
  createMockInventoryServiceGatewayResponse,
} from '../../../helpers/inventory-catalog-gateway-mock.factory';
import { createMockWorkOrder } from '../../../helpers/work-order-mock.factory';
import { createMockCustomer } from '../../../helpers/customer-mock.factory';
import { createMockVehicle } from '../../../helpers/vehicle-mock.factory';

function buildMockQuoteWithWorkOrder(): Quote {
  const customer = createMockCustomer();
  const vehicle = createMockVehicle({ customerId: customer.id });
  const workOrder = createMockWorkOrder({ customer, vehicle });
  const quote = createMockQuote({ services: [], partsSupplies: [] });
  quote.workOrder = workOrder;
  return quote;
}

describe('QuoteController', () => {
  let controller: QuoteController;
  let createQuoteUseCase: jest.Mocked<ICreateQuoteUseCase>;
  let findQuoteByIdUseCase: jest.Mocked<IFindQuoteByIdUseCase>;
  let addQuoteServiceUseCase: jest.Mocked<IAddQuoteServiceUseCase>;
  let removeQuoteServiceUseCase: jest.Mocked<IRemoveQuoteServiceUseCase>;
  let addQuotePartSupplyUseCase: jest.Mocked<IAddQuotePartSupplyUseCase>;
  let removeQuotePartSupplyUseCase: jest.Mocked<IRemoveQuotePartSupplyUseCase>;
  let updateQuoteServiceQuantityUseCase: jest.Mocked<IUpdateQuoteServiceQuantityUseCase>;
  let updateQuotePartSupplyQuantityUseCase: jest.Mocked<IUpdateQuotePartSupplyQuantityUseCase>;
  let submitQuoteUseCase: jest.Mocked<ISubmitQuoteUseCase>;
  let updateQuoteStatusUseCase: jest.Mocked<IUpdateQuoteStatusUseCase>;
  let findAllQuotesPaginatedUseCase: jest.Mocked<IFindAllQuotesPaginatedUseCase>;
  let findCatalogItemsUseCase: jest.Mocked<IFindCatalogItemsUseCase>;

  beforeEach(() => {
    createQuoteUseCase = { execute: jest.fn() };
    findQuoteByIdUseCase = { execute: jest.fn() };
    addQuoteServiceUseCase = { execute: jest.fn() };
    removeQuoteServiceUseCase = { execute: jest.fn() };
    addQuotePartSupplyUseCase = { execute: jest.fn() };
    removeQuotePartSupplyUseCase = { execute: jest.fn() };
    updateQuoteServiceQuantityUseCase = { execute: jest.fn() };
    updateQuotePartSupplyQuantityUseCase = { execute: jest.fn() };
    submitQuoteUseCase = { execute: jest.fn() };
    updateQuoteStatusUseCase = { execute: jest.fn() };
    findAllQuotesPaginatedUseCase = { execute: jest.fn() };
    findCatalogItemsUseCase = { execute: jest.fn() };

    controller = new QuoteController(
      createQuoteUseCase,
      findQuoteByIdUseCase,
      addQuoteServiceUseCase,
      removeQuoteServiceUseCase,
      addQuotePartSupplyUseCase,
      removeQuotePartSupplyUseCase,
      updateQuoteServiceQuantityUseCase,
      updateQuotePartSupplyQuantityUseCase,
      submitQuoteUseCase,
      updateQuoteStatusUseCase,
      findAllQuotesPaginatedUseCase,
      findCatalogItemsUseCase,
    );
  });

  it('should create a quote', async () => {
    const dto = { workOrderId: randomUUID(), notes: 'test' };
    const quote = buildMockQuoteWithWorkOrder();
    createQuoteUseCase.execute.mockResolvedValue(quote);

    const result = await controller.create(dto);

    expect(result).toEqual(QuotePresenter.toDataResponse(quote));
    expect(createQuoteUseCase.execute).toHaveBeenCalledWith(dto);
  });

  it('should find one quote with the catalog of its items', async () => {
    const service = createMockInventoryServiceGatewayResponse();
    const partSupply = createMockInventoryPartSupplyGatewayResponse();

    const quote = createMockQuote({
      services: [createMockQuoteService({ serviceId: service.id })],
      partsSupplies: [createMockQuotePartSupply({ partSupplyId: partSupply.id })],
    });

    quote.workOrder = createMockWorkOrder({
      customer: createMockCustomer(),
      vehicle: createMockVehicle(),
    });

    const catalog = { services: [service], partsSupplies: [partSupply] };

    findQuoteByIdUseCase.execute.mockResolvedValue(quote);
    findCatalogItemsUseCase.execute.mockResolvedValue(catalog);

    const result = await controller.findOne(quote.id);

    expect(findQuoteByIdUseCase.execute).toHaveBeenCalledWith(quote.id);

    expect(findCatalogItemsUseCase.execute).toHaveBeenCalledWith({
      serviceIds: [service.id],
      partSupplyIds: [partSupply.id],
    });

    expect(result).toEqual(QuotePresenter.toWithItemsResponse(quote, catalog));
  });

  it('should add a service', async () => {
    const id = randomUUID();
    const serviceId = randomUUID();

    const dto = { serviceId, quantity: 2 };
    const quote = buildMockQuoteWithWorkOrder();

    addQuoteServiceUseCase.execute.mockResolvedValue(quote);

    const result = await controller.addService(id, dto);

    expect(result).toEqual(QuotePresenter.toDataResponse(quote));

    expect(addQuoteServiceUseCase.execute).toHaveBeenCalledWith({ quoteId: id, ...dto });
  });

  it('should update a service', async () => {
    const id = randomUUID();
    const serviceId = randomUUID();

    const dto = { quantity: 3 };
    const quote = buildMockQuoteWithWorkOrder();

    updateQuoteServiceQuantityUseCase.execute.mockResolvedValue(quote);

    const result = await controller.updateService(id, serviceId, dto);

    expect(result).toEqual(QuotePresenter.toDataResponse(quote));
    expect(updateQuoteServiceQuantityUseCase.execute).toHaveBeenCalledWith({
      quoteId: id,
      serviceId,
      ...dto,
    });
  });

  it('should remove a service', async () => {
    const id = randomUUID();
    const serviceId = randomUUID();

    removeQuoteServiceUseCase.execute.mockResolvedValue(buildMockQuoteWithWorkOrder());

    await controller.removeService(id, serviceId);

    expect(removeQuoteServiceUseCase.execute).toHaveBeenCalledWith(id, serviceId);
  });

  it('should add a part supply', async () => {
    const id = randomUUID();
    const partSupplyId = randomUUID();

    const dto = { partSupplyId, quantity: 2 };

    const quote = buildMockQuoteWithWorkOrder();

    addQuotePartSupplyUseCase.execute.mockResolvedValue(quote);

    const result = await controller.addPartSupply(id, dto);

    expect(result).toEqual(QuotePresenter.toDataResponse(quote));

    expect(addQuotePartSupplyUseCase.execute).toHaveBeenCalledWith({ quoteId: id, ...dto });
  });

  it('should update a part supply', async () => {
    const id = randomUUID();
    const partSupplyId = randomUUID();

    const dto = { quantity: 3 };
    const quote = buildMockQuoteWithWorkOrder();

    updateQuotePartSupplyQuantityUseCase.execute.mockResolvedValue(quote);

    const result = await controller.updatePartSupply(id, partSupplyId, dto);

    expect(result).toEqual(QuotePresenter.toDataResponse(quote));
    expect(updateQuotePartSupplyQuantityUseCase.execute).toHaveBeenCalledWith({
      quoteId: id,
      partSupplyId,
      ...dto,
    });
  });

  it('should remove a part supply', async () => {
    const id = randomUUID();
    const partSupplyId = randomUUID();

    removeQuotePartSupplyUseCase.execute.mockResolvedValue(buildMockQuoteWithWorkOrder());

    await controller.removePartSupply(id, partSupplyId);

    expect(removeQuotePartSupplyUseCase.execute).toHaveBeenCalledWith(id, partSupplyId);
  });

  it('should submit a quote', async () => {
    const id = randomUUID();
    const quote = buildMockQuoteWithWorkOrder();

    submitQuoteUseCase.execute.mockResolvedValue(quote);

    const result = await controller.submit(id);

    expect(result).toEqual(QuotePresenter.toDataResponse(quote));
    expect(submitQuoteUseCase.execute).toHaveBeenCalledWith(id);
  });

  it('should update status', async () => {
    const id = randomUUID();
    const userId = randomUUID();

    const dto: UpdateQuoteStatusRequest = { status: QuoteStatus.APPROVED };

    const quote = buildMockQuoteWithWorkOrder();
    updateQuoteStatusUseCase.execute.mockResolvedValue(quote);

    const result = await controller.updateStatus(id, userId, dto);

    expect(result).toEqual(QuotePresenter.toDataResponse(quote));
    expect(updateQuoteStatusUseCase.execute).toHaveBeenCalledWith(id, userId, dto);
  });

  it('should list all quotes paginated', async () => {
    const resultUseCase = {
      items: [],
      pagination: { totalRecords: 0, totalPages: 0, page: 1, limit: 10 },
    };

    findAllQuotesPaginatedUseCase.execute.mockResolvedValue(resultUseCase);

    const result = await controller.findAll({ page: 1, limit: 10 });

    expect(result).toEqual(QuotePresenter.toPaginatedResponse(resultUseCase));
    expect(findAllQuotesPaginatedUseCase.execute).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
    });
  });

  it('should list all quotes with default pagination', async () => {
    findAllQuotesPaginatedUseCase.execute.mockResolvedValue({
      items: [],
      pagination: { totalRecords: 0, totalPages: 0, page: 1, limit: 10 },
    });

    await controller.findAll({});

    expect(findAllQuotesPaginatedUseCase.execute).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
    });
  });
});
