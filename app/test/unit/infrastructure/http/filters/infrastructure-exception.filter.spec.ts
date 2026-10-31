import { ArgumentsHost, HttpStatus } from '@nestjs/common';

import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';

import { InfrastructureExceptionFilter } from '@infrastructure/http/filters/infrastructure-exception.filter';

import { AuthenticationFailedException } from '@infrastructure/exceptions/authentication-failed.exception';
import { DatabaseOperationException } from '@infrastructure/exceptions/database-operation.exception';
import { InfrastructureException } from '@infrastructure/exceptions/infrastructure.exception';
import { ConcurrencyException } from '@infrastructure/exceptions/concurrency.exception';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';
import { getRequestLogContext } from '@infrastructure/logging/request-log-context';

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

class GenericInfrastructureException extends InfrastructureException {
  constructor(message: string) {
    super(message);
  }
}

describe('InfrastructureExceptionFilter', () => {
  let filter: InfrastructureExceptionFilter;
  let logger: jest.Mocked<ILogger>;

  beforeEach(() => {
    logger = createMockLogger();
    filter = new InfrastructureExceptionFilter(logger);
  });

  it('should return 401 for AuthenticationFailedException', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new AuthenticationFailedException('Token inválido');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.UNAUTHORIZED,
      error: 'Unauthorized',
      message: 'Token inválido',
    });
  });

  it('should return 401 for AuthenticationFailedException with default message', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new AuthenticationFailedException();

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.UNAUTHORIZED,
      error: 'Unauthorized',
      message: 'Falha na autenticação',
    });
  });

  it('should return 503 for DatabaseOperationException', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new DatabaseOperationException('INSERT', 'conexão recusada');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message: 'Erro na operação INSERT: conexão recusada',
    });
  });

  it('should return 503 for DatabaseOperationException without detail', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new DatabaseOperationException('DELETE');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message: 'Erro na operação DELETE',
    });
  });

  it('should return 409 for ConcurrencyException', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new ConcurrencyException('Conflito de versão');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'Conflito de versão',
    });
  });

  it('should return 500 for generic InfrastructureException', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new GenericInfrastructureException('Erro inesperado');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Erro inesperado',
    });
  });

  it('should not emit an error line for a 401, and record no stack', () => {
    const { host, mockResponse } = createMockHost();
    const exception = new AuthenticationFailedException('Token inválido');

    filter.catch(exception, host);

    expect(logger.event).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(getRequestLogContext(mockResponse)).toEqual({
      errorType: 'AuthenticationFailedException',
      errorMessage: 'Token inválido',
    });
  });

  it('should not emit an error line for a 409', () => {
    const { host } = createMockHost();

    filter.catch(new ConcurrencyException('Orçamento quote-1 foi alterado'), host);

    expect(logger.event).not.toHaveBeenCalled();
  });

  it('should emit exactly one error line for a 503 with the exception attached', () => {
    const { host, mockResponse } = createMockHost();
    const exception = new DatabaseOperationException('SELECT', 'timeout');

    filter.catch(exception, host);

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.HTTP_REQUEST_FAILED, {}, exception);
    expect(getRequestLogContext(mockResponse).errorType).toBe('DatabaseOperationException');
  });

  it('should resolve the status before deciding whether to log', () => {
    const { host, statusFn } = createMockHost();

    filter.catch(new AuthenticationFailedException('Token inválido'), host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(logger.event).not.toHaveBeenCalled();
  });
});
