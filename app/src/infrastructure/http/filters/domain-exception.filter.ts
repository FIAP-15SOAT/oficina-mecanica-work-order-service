import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Inject } from '@nestjs/common';
import { Request, Response } from 'express';

import { DomainException } from '@domain/exceptions/domain.exception';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { EntityNotFoundException } from '@domain/exceptions/entity-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { recordHttpFailure } from '@infrastructure/logging/http-failure.recorder';

@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger: ILogger;

  constructor(@Inject('ILogger') logger: ILogger) {
    this.logger = logger.forContext(DomainExceptionFilter.name);
  }

  catch(exception: DomainException, host: ArgumentsHost): void {
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

  private resolveHttpStatus(exception: DomainException): { status: number; error: string } {
    if (exception instanceof DomainValidationException) {
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, error: 'Unprocessable Entity' };
    }

    if (exception instanceof EntityNotFoundException) {
      return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
    }

    if (exception instanceof BusinessRuleViolationException) {
      return { status: HttpStatus.CONFLICT, error: 'Conflict' };
    }

    return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request' };
  }
}
