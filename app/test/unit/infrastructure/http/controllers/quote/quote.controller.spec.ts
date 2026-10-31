import { randomUUID } from 'node:crypto';

import { QuoteController } from '@infrastructure/http/controllers/quote/quote.controller';
import { QuoteController as QuoteCleanController } from '@interface-adapters/quote/quote.controller';
import { QuotePresenter } from '@interface-adapters/quote/quote.presenter';

import { Quote } from '@domain/entities/quote.entity';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { UserRole } from '@domain/enums/user-role.enum';
import { AuthFlow } from '@domain/enums/auth-flow.enum';

import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { CreateQuoteRequestDto } from '@infrastructure/http/controllers/quote/dto/requests/create-quote-request.dto';
import { AddQuoteServiceRequestDto } from '@infrastructure/http/controllers/quote/dto/requests/add-quote-service-request.dto';
import { AddQuotePartSupplyRequestDto } from '@infrastructure/http/controllers/quote/dto/requests/add-quote-part-supply-request.dto';
import { UpdateQuoteServiceItemRequestDto } from '@infrastructure/http/controllers/quote/dto/requests/update-quote-service-item-request.dto';
import { UpdateQuotePartSupplyItemRequestDto } from '@infrastructure/http/controllers/quote/dto/requests/update-quote-part-supply-item-request.dto';
import { UpdateQuoteStatusRequestDto } from '@infrastructure/http/controllers/quote/dto/requests/update-quote-status-request.dto';
import { FindAllQuotesQueryDto } from '@infrastructure/http/controllers/quote/dto/requests/find-all-quotes-query.dto';

import { createMockQuote } from '../../../../../helpers/quote-mock.factory';
import { createMockWorkOrder } from '../../../../../helpers/work-order-mock.factory';
import { createMockCustomer } from '../../../../../helpers/customer-mock.factory';
import { createMockVehicle } from '../../../../../helpers/vehicle-mock.factory';

describe('QuoteController', () => {
  let httpController: QuoteController;
  let cleanController: QuoteCleanController;

  const quoteStub: Quote = createMockQuote({ services: [], partsSupplies: [] });
  quoteStub.workOrder = createMockWorkOrder({
    customer: createMockCustomer(),
    vehicle: createMockVehicle(),
  });

  beforeEach(() => {
    cleanController = new QuoteCleanController(
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
    );
    httpController = new QuoteController(cleanController);
  });

  describe('findAll', () => {
    it('should pass the query straight to the clean controller and return its result', async () => {
      const query: FindAllQuotesQueryDto = { page: 1, limit: 10, status: QuoteStatus.PENDING };
      const response = QuotePresenter.toPaginatedResponse({
        items: [quoteStub],
        pagination: { totalRecords: 1, totalPages: 1, page: 1, limit: 10 },
      });
      jest.spyOn(cleanController, 'findAll').mockResolvedValue(response);

      const result = await httpController.findAll(query);

      expect(result).toBe(response);
      expect(cleanController.findAll).toHaveBeenCalledWith(query);
    });
  });

  describe('create', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const dto: CreateQuoteRequestDto = { workOrderId: randomUUID(), notes: 'Troca de óleo' };
      const response = QuotePresenter.toDataResponse(quoteStub);
      jest.spyOn(cleanController, 'create').mockResolvedValue(response);

      const result = await httpController.create(dto);

      expect(result).toBe(response);
      expect(cleanController.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findOne', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const id = randomUUID();
      const response = QuotePresenter.toWithItemsResponse(quoteStub);
      jest.spyOn(cleanController, 'findOne').mockResolvedValue(response);

      const result = await httpController.findOne(id);

      expect(result).toBe(response);
      expect(cleanController.findOne).toHaveBeenCalledWith(id);
    });
  });

  describe('addService', () => {
    it('should delegate to the clean controller with id and body', async () => {
      const id = randomUUID();
      const dto: AddQuoteServiceRequestDto = { serviceId: randomUUID(), quantity: 2 };
      const response = QuotePresenter.toDataResponse(quoteStub);
      jest.spyOn(cleanController, 'addService').mockResolvedValue(response);

      const result = await httpController.addService(id, dto);

      expect(result).toBe(response);
      expect(cleanController.addService).toHaveBeenCalledWith(id, dto);
    });
  });

  describe('updateService', () => {
    it('should delegate to the clean controller with ids and body', async () => {
      const id = randomUUID();
      const serviceId = randomUUID();
      const dto: UpdateQuoteServiceItemRequestDto = { quantity: 3 };
      const response = QuotePresenter.toDataResponse(quoteStub);
      jest.spyOn(cleanController, 'updateService').mockResolvedValue(response);

      const result = await httpController.updateService(id, serviceId, dto);

      expect(result).toBe(response);
      expect(cleanController.updateService).toHaveBeenCalledWith(id, serviceId, dto);
    });
  });

  describe('removeService', () => {
    it('should delegate to the clean controller with ids', async () => {
      const id = randomUUID();
      const serviceId = randomUUID();
      jest.spyOn(cleanController, 'removeService').mockResolvedValue(undefined);

      await httpController.removeService(id, serviceId);

      expect(cleanController.removeService).toHaveBeenCalledWith(id, serviceId);
    });
  });

  describe('addPartSupply', () => {
    it('should delegate to the clean controller with id and body', async () => {
      const id = randomUUID();
      const dto: AddQuotePartSupplyRequestDto = { partSupplyId: randomUUID(), quantity: 2 };
      const response = QuotePresenter.toDataResponse(quoteStub);
      jest.spyOn(cleanController, 'addPartSupply').mockResolvedValue(response);

      const result = await httpController.addPartSupply(id, dto);

      expect(result).toBe(response);
      expect(cleanController.addPartSupply).toHaveBeenCalledWith(id, dto);
    });
  });

  describe('updatePartSupply', () => {
    it('should delegate to the clean controller with ids and body', async () => {
      const id = randomUUID();
      const partSupplyId = randomUUID();
      const dto: UpdateQuotePartSupplyItemRequestDto = { quantity: 3 };
      const response = QuotePresenter.toDataResponse(quoteStub);
      jest.spyOn(cleanController, 'updatePartSupply').mockResolvedValue(response);

      const result = await httpController.updatePartSupply(id, partSupplyId, dto);

      expect(result).toBe(response);
      expect(cleanController.updatePartSupply).toHaveBeenCalledWith(id, partSupplyId, dto);
    });
  });

  describe('removePartSupply', () => {
    it('should delegate to the clean controller with ids', async () => {
      const id = randomUUID();
      const partSupplyId = randomUUID();
      jest.spyOn(cleanController, 'removePartSupply').mockResolvedValue(undefined);

      await httpController.removePartSupply(id, partSupplyId);

      expect(cleanController.removePartSupply).toHaveBeenCalledWith(id, partSupplyId);
    });
  });

  describe('submit', () => {
    it('should delegate to the clean controller with id', async () => {
      const id = randomUUID();
      const response = QuotePresenter.toDataResponse(quoteStub);
      jest.spyOn(cleanController, 'submit').mockResolvedValue(response);

      const result = await httpController.submit(id);

      expect(result).toBe(response);
      expect(cleanController.submit).toHaveBeenCalledWith(id);
    });
  });

  describe('updateStatus', () => {
    it('should delegate to the clean controller with the authenticated user id', async () => {
      const id = randomUUID();
      const userId = randomUUID();
      const dto: UpdateQuoteStatusRequestDto = { status: QuoteStatus.APPROVED };
      const user: AuthenticatedPrincipal = {
        sub: userId,
        authFlow: AuthFlow.INTERNAL,
        email: 'atendente@oficina.local',
        role: UserRole.ATTENDANT,
      };
      const response = QuotePresenter.toDataResponse(quoteStub);
      jest.spyOn(cleanController, 'updateStatus').mockResolvedValue(response);

      const result = await httpController.updateStatus(id, dto, user);

      expect(result).toBe(response);
      expect(cleanController.updateStatus).toHaveBeenCalledWith(id, userId, dto);
    });
  });
});
