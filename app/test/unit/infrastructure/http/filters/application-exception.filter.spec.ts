import { ArgumentsHost, HttpStatus } from '@nestjs/common';

import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { ApplicationException } from '@application/exceptions/application.exception';

import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BadRequestException } from '@application/exceptions/bad-request.exception';
import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';
import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';

import { ApplicationExceptionFilter } from '@infrastructure/http/filters/application-exception.filter';
import { getRequestLogContext } from '@infrastructure/logging/request-log-context';

class GenericApplicationException extends ApplicationException {
  constructor(message: string) {
    super(message);
  }
}

function createMockHost() {
  const jsonFn = jest.fn();
  const statusFn = jest.fn().mockReturnValue({ json: jsonFn });
  const mockResponse = { status: statusFn, locals: {} };

  const host = {
    switchToHttp: () => ({
      getResponse: <T = typeof mockResponse>(): T => mockResponse as T,
      getRequest: jest.fn(),
      getNext: jest.fn(),
    }),
    getArgs: jest.fn(),
    getArgByIndex: jest.fn(),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn(),
    getType: jest.fn(),
  } satisfies ArgumentsHost;

  return { host, statusFn, jsonFn, mockResponse };
}

describe('ApplicationExceptionFilter', () => {
  let filter: ApplicationExceptionFilter;
  let logger: jest.Mocked<ILogger>;

  beforeEach(() => {
    logger = createMockLogger();
    filter = new ApplicationExceptionFilter(logger);
  });

  it('should return 400 for BadRequestException', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new BadRequestException('Parâmetro inválido');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      message: 'Parâmetro inválido',
    });
  });

  it('should return 404 for ResourceNotFoundException', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new ResourceNotFoundException('Usuário', 'uuid-123');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.NOT_FOUND,
      error: 'Not Found',
      message: 'Usuário não encontrado(a) com identificador: uuid-123',
    });
  });

  it('should return 409 for ResourceConflictException', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new ResourceConflictException('E-mail já cadastrado no sistema');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'E-mail já cadastrado no sistema',
    });
  });

  it('should return 401 for UnauthorizedAccessException', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new UnauthorizedAccessException('Credenciais inválidas');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.UNAUTHORIZED,
      error: 'Unauthorized',
      message: 'Credenciais inválidas',
    });
  });

  it('should answer the owner status and the standard error body for ServiceRequestRejectedException', () => {
    const { host, statusFn, jsonFn } = createMockHost();

    const exception = new ServiceRequestRejectedException(422, 'Estoque insuficiente');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);

    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      error: 'Unprocessable Entity',
      message: 'Estoque insuficiente',
    });
  });

  it('should answer a generic error name for an owner status without a standard name', () => {
    const { host, jsonFn } = createMockHost();

    filter.catch(new ServiceRequestRejectedException(499, 'Recusado'), host);

    expect(jsonFn).toHaveBeenCalledWith({ statusCode: 499, error: 'Error', message: 'Recusado' });
  });

  it('should return 500 for generic ApplicationException', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new GenericApplicationException('Erro inesperado na aplicação');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Erro inesperado na aplicação',
    });
  });

  it('should record the resolved error in the request-local context without emitting a line on a 404', () => {
    const { host, mockResponse } = createMockHost();

    filter.catch(new ResourceNotFoundException('Orçamento', 'quote-1'), host);

    expect(logger.event).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(getRequestLogContext(mockResponse).errorType).toBe('ResourceNotFoundException');
  });

  it('should emit no extra line on a 409', () => {
    const { host } = createMockHost();

    filter.catch(new ResourceConflictException('E-mail já cadastrado'), host);

    expect(logger.event).not.toHaveBeenCalled();
  });
});
