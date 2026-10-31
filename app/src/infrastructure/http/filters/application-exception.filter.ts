import { STATUS_CODES } from 'node:http';
import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Inject } from '@nestjs/common';
import { Request, Response } from 'express';

import { ApplicationException } from '@application/exceptions/application.exception';
import { BadRequestException } from '@application/exceptions/bad-request.exception';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';
import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { recordHttpFailure } from '@infrastructure/logging/http-failure.recorder';

@Catch(ApplicationException)
export class ApplicationExceptionFilter implements ExceptionFilter {
  private readonly logger: ILogger;

  constructor(@Inject('ILogger') logger: ILogger) {
    this.logger = logger.forContext(ApplicationExceptionFilter.name);
  }

  catch(exception: ApplicationException, host: ArgumentsHost): void {
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

  private resolveHttpStatus(exception: ApplicationException): { status: number; error: string } {
    if (exception instanceof BadRequestException) {
      return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request' };
    }

    if (exception instanceof ResourceNotFoundException) {
      return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
    }

    if (exception instanceof ResourceConflictException) {
      return { status: HttpStatus.CONFLICT, error: 'Conflict' };
    }

    if (exception instanceof UnauthorizedAccessException) {
      return { status: HttpStatus.UNAUTHORIZED, error: 'Unauthorized' };
    }

    if (exception instanceof ServiceRequestRejectedException) {
      return {
        status: exception.statusCode,
        error: STATUS_CODES[exception.statusCode] ?? 'Error',
      };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, error: 'Internal Server Error' };
  }
}
