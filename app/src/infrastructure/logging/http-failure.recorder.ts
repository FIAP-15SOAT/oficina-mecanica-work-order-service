import { ILogger } from '@application/ports/output/services/logger.service.interface';

import { resolveErrorType } from './error-serializer';
import { resolveHttpErrorMessage } from './http-error-message';
import { runSafelyVoid } from './logging-diagnostics';
import { assignRequestLogContext } from './request-log-context';
import { TECHNICAL_EVENTS } from './technical-event.catalog';

export function recordHttpFailure(
  logger: ILogger,
  request: unknown,
  response: unknown,
  status: number,
  exception: unknown,
): void {
  runSafelyVoid('http-failure', () => {
    assignRequestLogContext(response, {
      errorType: resolveErrorType(exception),
      errorMessage: resolveHttpErrorMessage(exception, request, status),
    });
  });

  if (status >= 500) {
    logger.event(TECHNICAL_EVENTS.HTTP_REQUEST_FAILED, {}, exception);
  }
}
