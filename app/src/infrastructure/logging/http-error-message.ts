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
 * O `initMessage()` do Nest só copia `response.message` quando ela é string.
 * Para o `string[]` que o `ValidationPipe` produz, `exception.message` vira o
 * nome da classe humanizado — `"Bad Request Exception"` —, e a causa real da
 * rejeição, que é o 4xx mais comum da API, nunca chegava ao log.
 *
 * A quantidade e o tamanho são limitados porque o array é derivado do payload:
 * um corpo com muitos campos inválidos produz muitas mensagens.
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
