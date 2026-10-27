import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

import { ILogger } from '@application/ports/output/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { AllExceptionsFilter } from '@infrastructure/http/filters/all-exceptions.filter';
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

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let logger: jest.Mocked<ILogger>;

  beforeEach(() => {
    logger = createMockLogger();
    filter = new AllExceptionsFilter(logger);
  });

  it('should return the HttpException status and message for 4xx errors', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new HttpException('Recurso não encontrado', HttpStatus.NOT_FOUND);

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.NOT_FOUND,
      error: 'Not Found',
      message: 'Recurso não encontrado',
    });

    expect(logger.event).not.toHaveBeenCalled();
  });

  it('should return correct error name for 401 Unauthorized', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new HttpException('Não autenticado', HttpStatus.UNAUTHORIZED);

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.UNAUTHORIZED,
      error: 'Unauthorized',
      message: 'Não autenticado',
    });
  });

  it('should return correct error name for 403 Forbidden', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new HttpException('Acesso negado', HttpStatus.FORBIDDEN);

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.FORBIDDEN,
      error: 'Forbidden',
      message: 'Acesso negado',
    });
  });

  it('should return correct error name for 409 Conflict', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new HttpException('Conflito detectado', HttpStatus.CONFLICT);

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'Conflito detectado',
    });
  });

  it('should return "Error" for unknown status codes', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    // Use a SyntaxError with body to trigger the unknown status path via resolveStatus → BAD_REQUEST
    // But to test unknown status, we use an HttpException with a rare code
    const exception = new HttpException('Teapot', 418);

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(418);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: 418,
      error: 'Error',
      message: 'Teapot',
    });
  });

  it('should return 500 and generic message for unknown Error instances', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new Error('Erro inesperado no sistema');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.HTTP_REQUEST_FAILED, {}, exception);
  });

  it('should return 500 and log "Unexpected error" when a non-Error value is thrown', () => {
    const { host, statusFn, jsonFn } = createMockHost();

    filter.catch('string thrown as exception', host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(
      TECHNICAL_EVENTS.HTTP_REQUEST_FAILED,
      {},
      'string thrown as exception',
    );
  });

  it('should return 400 for SyntaxError with body property (malformed JSON body)', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = Object.assign(new SyntaxError('Unexpected token'), { body: '{ invalid' });

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      message: 'Bad request',
    });
    expect(logger.event).not.toHaveBeenCalled();
  });

  /**
   * `body-parser` runs before the Nest pipeline and throws `http-errors`
   * instances: they carry `status`/`statusCode`, but are not `HttpException`.
   * Without recognizing them, a body above 100 kB became `500` — the client got
   * "unexpected error" for its own mistake, and the filter still emitted an
   * `ERROR` line with a stack, unauthenticated and without a sibling access log.
   */
  describe('body parser errors (http-errors, not HttpException)', () => {
    function createPayloadTooLarge(): Error {
      return Object.assign(new Error('request entity too large'), {
        status: 413,
        statusCode: 413,
        type: 'entity.too.large',
        expose: true,
      });
    }

    it('should resolve an oversized body to 413 instead of 500', () => {
      const { host, statusFn, jsonFn } = createMockHost();

      filter.catch(createPayloadTooLarge(), host);

      expect(statusFn).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(jsonFn).toHaveBeenCalledWith({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        error: 'Payload Too Large',
        message: 'request entity too large',
      });
    });

    it('should not emit a dedicated error line for an oversized body', () => {
      const { host } = createMockHost();

      filter.catch(createPayloadTooLarge(), host);

      expect(logger.event).not.toHaveBeenCalled();
    });

    it('should recognize an unsupported charset as 415', () => {
      const { host, statusFn } = createMockHost();

      filter.catch(
        Object.assign(new Error('unsupported charset'), { status: 415, expose: true }),
        host,
      );

      expect(statusFn).toHaveBeenCalledWith(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    });

    it('should keep an ordinary error at 500 when it carries no usable status', () => {
      const { host, statusFn } = createMockHost();

      filter.catch(Object.assign(new Error('quebrou'), { status: 'nope' }), host);

      expect(statusFn).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(logger.event).toHaveBeenCalledTimes(1);
    });

    it('should ignore a carried status outside the http error range', () => {
      const { host, statusFn } = createMockHost();

      filter.catch(Object.assign(new Error('quebrou'), { status: 200 }), host);

      expect(statusFn).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('should not expose the message of an error that is not marked as exposable', () => {
      const { host, jsonFn } = createMockHost();

      filter.catch(
        Object.assign(new Error('detalhe interno'), { status: 400, expose: false }),
        host,
      );

      expect(jsonFn).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Bad request',
      });
    });
  });

  it('should return the message array from HttpException response object (e.g. validation errors)', () => {
    const { host, statusFn, jsonFn } = createMockHost();
    const exception = new HttpException(
      {
        message: ['name must not be empty', 'email must be an email'],
        error: 'Bad Request',
        statusCode: 400,
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      message: ['name must not be empty', 'email must be an email'],
    });
    expect(logger.event).not.toHaveBeenCalled();
  });

  it('should record the resolved error type and message in the request-local context on a 4xx', () => {
    const { host, mockResponse } = createMockHost();

    filter.catch(new HttpException('Recurso não encontrado', HttpStatus.NOT_FOUND), host);

    expect(getRequestLogContext(mockResponse)).toEqual({
      errorType: 'HttpException',
      errorMessage: 'Recurso não encontrado',
    });
    expect(logger.event).not.toHaveBeenCalled();
  });

  it('should record the resolved error type and message in the request-local context on a 5xx', () => {
    const { host, mockResponse } = createMockHost();

    filter.catch(new Error('Erro inesperado no sistema'), host);

    expect(getRequestLogContext(mockResponse)).toEqual({
      errorType: 'Error',
      errorMessage: 'Erro inesperado no sistema',
    });
  });

  it('should not throw when the response carries no locals', () => {
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json: jest.fn() }) }),
        getRequest: jest.fn(),
        getNext: jest.fn(),
      }),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
      getType: jest.fn(),
    } as unknown as ArgumentsHost;

    expect(() => filter.catch(new Error('boom'), host)).not.toThrow();
  });
});
