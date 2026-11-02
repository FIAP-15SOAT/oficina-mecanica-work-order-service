import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosResponse } from 'axios';
import { PinoLogger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';

import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';

import {
  INTERNAL_HTTP_DEFAULT_TIMEOUT_MS,
  InternalHttpClient,
} from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';

const URL = 'http://inventory-service.inventory:3000/internal/reservations';

describe('InternalHttpClient', () => {
  let http: jest.Mocked<Pick<HttpService, 'request'>>;
  let bindings: jest.Mock;
  let client: InternalHttpClient;

  beforeEach(() => {
    http = { request: jest.fn() };
    bindings = jest.fn().mockReturnValue({ 'request.id': 'req-1' });
    const pinoLogger = { logger: { bindings } } as unknown as PinoLogger;
    client = new InternalHttpClient(http as unknown as HttpService, pinoLogger);
  });

  it('should return the body and send x-request-id from the active log context', async () => {
    http.request.mockReturnValue(of({ data: { data: { id: 'wo-1' } } } as AxiosResponse));

    const result = await client.request({ method: 'POST', url: URL, body: { a: 1 } });

    expect(result).toEqual({ data: { id: 'wo-1' } });
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      url: URL,
      data: { a: 1 },
      timeout: INTERNAL_HTTP_DEFAULT_TIMEOUT_MS,
      maxRedirects: 0,
      headers: { 'x-request-id': 'req-1' },
    });
  });

  it('should send the message id as x-request-id inside a message handler', async () => {
    bindings.mockReturnValue({ 'request.id': 'message-1' });
    http.request.mockReturnValue(of({ data: {} } as AxiosResponse));

    await client.request({ method: 'GET', url: URL });

    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'x-request-id': 'message-1' } }),
    );
  });

  it('should use 2000 ms as the default timeout and the caller timeout when given', async () => {
    http.request.mockReturnValue(of({ data: {} } as AxiosResponse));

    await client.request({ method: 'GET', url: URL });
    await client.request({ method: 'GET', url: URL, timeoutMs: 5_000 });

    expect(INTERNAL_HTTP_DEFAULT_TIMEOUT_MS).toBe(2_000);
    expect(http.request).toHaveBeenNthCalledWith(1, expect.objectContaining({ timeout: 2_000 }));
    expect(http.request).toHaveBeenNthCalledWith(2, expect.objectContaining({ timeout: 5_000 }));
  });

  it.each([404, 409, 422])(
    'should pass a %i through as ServiceRequestRejectedException with the owner message',
    async (status) => {
      http.request.mockReturnValue(
        throwError(() => ({
          response: {
            status,
            data: { statusCode: status, error: 'Owner Error', message: 'Estoque insuficiente.' },
          },
        })),
      );

      const error = await client.request({ method: 'POST', url: URL }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceRequestRejectedException);
      expect(error).toMatchObject({ statusCode: status, message: 'Estoque insuficiente.' });
    },
  );

  it('should use a default message when the owner 4xx has no message', async () => {
    http.request.mockReturnValue(throwError(() => ({ response: { status: 403, data: '' } })));

    await expect(client.request({ method: 'DELETE', url: URL })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Requisição recusada pelo serviço de destino',
    });
  });

  it.each([301, 500, 503])('should turn a %i into ServiceIntegrationException', async (status) => {
    http.request.mockReturnValue(
      throwError(() => ({ response: { status, data: { message: 'boom' } } })),
    );

    await expect(client.request({ method: 'GET', url: URL })).rejects.toThrow(
      new ServiceIntegrationException('Serviço de destino indisponível'),
    );
  });

  it.each([AxiosError.ECONNABORTED, 'ECONNREFUSED'])(
    'should turn %s into ServiceIntegrationException without retrying',
    async (code) => {
      http.request.mockReturnValue(throwError(() => new AxiosError('Request failed', code)));

      await expect(client.request({ method: 'GET', url: URL })).rejects.toBeInstanceOf(
        ServiceIntegrationException,
      );
      expect(http.request).toHaveBeenCalledTimes(1);
    },
  );
});
