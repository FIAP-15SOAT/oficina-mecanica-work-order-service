import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';

import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';

import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import {
  REQUEST_ID_ATTRIBUTE,
  REQUEST_ID_HEADER,
} from '@infrastructure/logging/access-log.builder';

export const INTERNAL_HTTP_DEFAULT_TIMEOUT_MS = 2_000;

const CLIENT_ERROR_STATUS = 400;
const SERVER_ERROR_STATUS = 500;
const UNAVAILABLE_MESSAGE = 'Serviço de destino indisponível.';
const REJECTED_MESSAGE = 'Requisição recusada pelo serviço de destino.';

export interface InternalRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  timeoutMs?: number;
}

interface OwnerErrorBody {
  message: unknown;
}

@Injectable()
export class InternalHttpClient {
  constructor(
    private readonly http: HttpService,
    private readonly pinoLogger: PinoLogger,
  ) {}

  async request<T>({ method, url, body, timeoutMs }: InternalRequest): Promise<T> {
    // request.id is the HTTP request id or, inside a message handler, the message id.
    const requestId = this.pinoLogger.logger.bindings()[REQUEST_ID_ATTRIBUTE] as string | undefined;

    try {
      const response = await firstValueFrom(
        this.http.request<T>({
          method,
          url,
          data: body,
          timeout: timeoutMs ?? INTERNAL_HTTP_DEFAULT_TIMEOUT_MS,
          maxRedirects: 0,
          headers: { [REQUEST_ID_HEADER]: requestId },
        }),
      );

      return response.data;
    } catch (error) {
      throw this.toApplicationError(error as AxiosError<Partial<OwnerErrorBody>>);
    }
  }

  private toApplicationError(error: AxiosError<Partial<OwnerErrorBody>>): Error {
    const { response } = error;

    if (
      response === undefined ||
      response.status < CLIENT_ERROR_STATUS ||
      response.status >= SERVER_ERROR_STATUS
    ) {
      return new ServiceIntegrationException(UNAVAILABLE_MESSAGE);
    }

    const { message } = { ...response.data };

    return new ServiceRequestRejectedException(
      response.status,
      typeof message === 'string' ? message : REJECTED_MESSAGE,
    );
  }
}
