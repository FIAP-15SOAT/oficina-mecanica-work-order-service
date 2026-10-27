import { HttpException } from '@nestjs/common';
import { Request } from 'express';

import { MAX_TEXT_LENGTH, sanitizeText } from './redaction/text-sanitizer';
import { buildQueryString, resolveRequestPath, sanitizeUrlPath } from './url-attributes';

const MAX_DETAIL_ENTRIES = 10;

const DETAIL_SEPARATOR = '; ';

const NOT_FOUND_STATUS = 404;

const UNKNOWN_ERROR_MESSAGE = 'Unknown error';

export function resolveHttpErrorMessage(
  exception: unknown,
  request: unknown,
  status: number,
): string {
  const detail = extractDetail(exception);

  if (isFrameworkNotFound(detail, request, status)) {
    return buildUnmatchedRouteMessage(request as Request);
  }

  return sanitizeText(detail, MAX_TEXT_LENGTH);
}

function isFrameworkNotFound(detail: string, request: unknown, status: number): boolean {
  if (status !== NOT_FOUND_STATUS) {
    return false;
  }

  const candidate = request as Request | undefined;

  if (candidate === undefined || candidate === null) {
    return false;
  }

  return detail === `Cannot ${candidate.method} ${candidate.originalUrl ?? ''}`;
}

function buildUnmatchedRouteMessage(request: Request): string {
  const path = sanitizeUrlPath(resolveRequestPath(request));
  const query = buildQueryString(request);
  const querySuffix = query ? `?${query}` : '';

  return `Cannot ${request.method} ${path}${querySuffix}`;
}

function extractDetail(exception: unknown): string {
  return extractHttpExceptionDetail(exception) ?? extractPlainMessage(exception);
}

function extractPlainMessage(exception: unknown): string {
  if (exception instanceof Error) {
    return exception.message;
  }

  if (typeof exception === 'string') {
    return exception;
  }

  return UNKNOWN_ERROR_MESSAGE;
}

/**
 * Nest's `initMessage()` only copies `response.message` when it is a string.
 * For the `string[]` that `ValidationPipe` produces, `exception.message` becomes
 * the humanized class name — `"Bad Request Exception"` —, and the real cause of
 * the rejection, the API's most common 4xx, never reached the log.
 *
 * Count and length are bounded because the array derives from the payload:
 * a body with many invalid fields produces many messages.
 */
function extractHttpExceptionDetail(exception: unknown): string | undefined {
  if (!(exception instanceof HttpException)) {
    return undefined;
  }

  const response = exception.getResponse();

  if (typeof response === 'string') {
    return response;
  }

  if (typeof response !== 'object' || response === null || !('message' in response)) {
    return undefined;
  }

  const message = response.message;

  if (typeof message === 'string') {
    return message;
  }

  if (!Array.isArray(message)) {
    return undefined;
  }

  const entries = message.slice(0, MAX_DETAIL_ENTRIES).map(String);

  if (message.length > MAX_DETAIL_ENTRIES) {
    entries.push(`(+${message.length - MAX_DETAIL_ENTRIES})`);
  }

  return entries.join(DETAIL_SEPARATOR);
}
