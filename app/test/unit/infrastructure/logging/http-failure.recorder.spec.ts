import { recordHttpFailure } from '@infrastructure/logging/http-failure.recorder';
import { getRequestLogContext } from '@infrastructure/logging/request-log-context';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import { createMockLogger } from '../../../helpers/logger-mock.factory';
import { captureDiagnostics } from '../../../helpers/diagnostics-capture';

function createResponse(): unknown {
  return { locals: {} };
}

function createRequest(): unknown {
  return { method: 'GET', originalUrl: '/api/customers', path: '/api/customers', query: {} };
}

describe('recordHttpFailure', () => {
  it('should enrich the request context with the resolved error on a 4xx', () => {
    const response = createResponse();

    recordHttpFailure(
      createMockLogger(),
      createRequest(),
      response,
      404,
      new Error('Orçamento não encontrado(a)'),
    );

    expect(getRequestLogContext(response)).toEqual({
      errorType: 'Error',
      errorMessage: 'Orçamento não encontrado(a)',
    });
  });

  it('should not emit a dedicated line for a 4xx', () => {
    const logger = createMockLogger();

    recordHttpFailure(logger, createRequest(), createResponse(), 401, new Error('sem credencial'));

    expect(logger.event).not.toHaveBeenCalled();
  });

  it('should emit one dedicated error line for a 5xx', () => {
    const logger = createMockLogger();
    const exception = new Error('conexão perdida');

    recordHttpFailure(logger, createRequest(), createResponse(), 500, exception);

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.HTTP_REQUEST_FAILED, {}, exception);
  });

  /**
   * The enrichment is called from inside the exception filter, **before** the
   * response is written, and reads `name`, `stack`, `cause` and `getResponse()`
   * from an object the application did not build. Outside the non-throwing
   * boundary, a hostile getter made logging change the response it should only
   * observe.
   */
  describe('error with a hostile getter', () => {
    function createHostileError(): Error {
      const hostile = new Error('hostil');

      Object.defineProperty(hostile, 'name', {
        get() {
          throw new RangeError('getter hostil');
        },
      });

      return hostile;
    }

    it('should not propagate the failure to the caller', () => {
      const stderr = captureDiagnostics();

      expect(() => {
        recordHttpFailure(
          createMockLogger(),
          createRequest(),
          createResponse(),
          400,
          createHostileError(),
        );
      }).not.toThrow();

      expect(stderr.spy).toHaveBeenCalled();

      stderr.restore();
    });

    it('should still emit the dedicated line for a 5xx when enrichment fails', () => {
      const stderr = captureDiagnostics();
      const logger = createMockLogger();

      recordHttpFailure(logger, createRequest(), createResponse(), 500, createHostileError());

      expect(logger.event).toHaveBeenCalledTimes(1);

      stderr.restore();
    });
  });
});
