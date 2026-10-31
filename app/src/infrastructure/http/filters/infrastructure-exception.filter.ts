import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Inject } from '@nestjs/common';
import { Request, Response } from 'express';

import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { recordHttpFailure } from '@infrastructure/logging/http-failure.recorder';
import { InfrastructureException } from '../../exceptions/infrastructure.exception';
import { AuthenticationFailedException } from '../../exceptions/authentication-failed.exception';
import { ConcurrencyException } from '@infrastructure/exceptions/concurrency.exception';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { DatabaseOperationException } from '@infrastructure/exceptions/database-operation.exception';

@Catch(InfrastructureException)
export class InfrastructureExceptionFilter implements ExceptionFilter {
  private readonly logger: ILogger;

  constructor(@Inject('ILogger') logger: ILogger) {
    this.logger = logger.forContext(InfrastructureExceptionFilter.name);
  }

  catch(exception: InfrastructureException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { status, error } = this.resolveHttpStatus(exception);

    recordHttpFailure(this.logger, request, response, status, exception);

    response.status(status).json({
      statusCode: status,
      error,
      message: exception.message,
    });
  }

  private resolveHttpStatus(exception: InfrastructureException): {
    status: number;
    error: string;
  } {
    if (exception instanceof AuthenticationFailedException) {
      return { status: HttpStatus.UNAUTHORIZED, error: 'Unauthorized' };
    }

    if (exception instanceof ConcurrencyException) {
      return { status: HttpStatus.CONFLICT, error: 'Conflict' };
    }

    if (
      exception instanceof ServiceIntegrationException ||
      exception instanceof DatabaseOperationException
    ) {
      return { status: HttpStatus.SERVICE_UNAVAILABLE, error: 'Service Unavailable' };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, error: 'Internal Server Error' };
  }
}
