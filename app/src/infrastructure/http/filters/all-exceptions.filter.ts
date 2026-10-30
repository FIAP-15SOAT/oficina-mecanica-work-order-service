import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { ILogger } from '@application/ports/output/logger.service.interface';
import { recordHttpFailure } from '@infrastructure/logging/http-failure.recorder';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger: ILogger;

  constructor(@Inject('ILogger') logger: ILogger) {
    this.logger = logger.forContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const status: HttpStatus = this.resolveStatus(exception);

    recordHttpFailure(this.logger, request, response, status, exception);

    const message = this.resolveMessage(status, exception);

    response.status(status).json({
      statusCode: status,
      error: this.resolveErrorName(status),
      message,
    });
  }

  private resolveMessage(status: HttpStatus, exception: unknown): string | string[] {
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'Ocorreu um erro inesperado';
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (typeof response === 'object' && response !== null && 'message' in response) {
        return (response as Record<string, unknown>).message as string | string[];
      }

      return exception.message;
    }

    if (!(exception instanceof SyntaxError) && this.isExposedHttpError(exception)) {
      return exception.message;
    }

    return 'Requisição inválida';
  }

  private isExposedHttpError(exception: unknown): exception is Error {
    return (
      exception instanceof Error &&
      (exception as { expose?: unknown }).expose === true &&
      this.resolveCarriedStatus(exception) !== undefined
    );
  }

  private resolveErrorName(status: HttpStatus): string {
    // Map HTTP status codes to their standard reason phrases
    const phrases: Partial<Record<number, string>> = {
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.METHOD_NOT_ALLOWED]: 'Method Not Allowed',
      [HttpStatus.CONFLICT]: 'Conflict',
      [HttpStatus.GONE]: 'Gone',
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload Too Large',
      [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported Media Type',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
      [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
      [HttpStatus.NOT_IMPLEMENTED]: 'Not Implemented',
      [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
    };

    return phrases[status] ?? 'Error';
  }

  private resolveStatus(exception: unknown): HttpStatus {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    if (exception instanceof SyntaxError && 'body' in exception) {
      return HttpStatus.BAD_REQUEST;
    }

    // `body-parser` runs before the Nest pipeline and throws `http-errors`
    // instances, which carry `status`/`statusCode` but are **not**
    // `HttpException`.
    return this.resolveCarriedStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveCarriedStatus(exception: unknown): HttpStatus | undefined {
    if (typeof exception !== 'object' || exception === null) {
      return undefined;
    }

    const candidate = exception as { status?: unknown; statusCode?: unknown };
    const carried = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;

    if (typeof carried !== 'number' || !Number.isInteger(carried)) {
      return undefined;
    }

    return carried >= 400 && carried <= 599 ? carried : undefined;
  }
}
