import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { Request, Response } from 'express';

import { isHealthProbePath } from '@infrastructure/health/health.constants';

import { ALLOWED_REQUEST_HEADERS } from './field-registry';
import { runSafely } from './logging-diagnostics';
import { extractResourceSegment } from './redaction/field-classifier';
import { serializeBody } from './redaction/payload-sanitizer';
import {
  MAX_HEADER_VALUE_LENGTH,
  MAX_USER_AGENT_LENGTH,
  sanitizeText,
} from './redaction/text-sanitizer';
import { getRequestLogContext } from './request-log-context';
import { buildQueryString, resolveRequestPath, sanitizeUrlPath } from './url-attributes';

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

export const CLIENT_ABORTED_ERROR_TYPE = 'client_aborted';
export const TRANSPORT_ERROR_ERROR_TYPE = 'transport_error';

export type HttpLogLevel = 'info' | 'warn' | 'error';

export type CompletionOutcome = 'completed' | 'client_aborted' | 'transport_error';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:+/=-]{1,128}$/;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const JSON_CONTENT_TYPE = /^application\/(json|[\w.+-]+\+json)\b/i;

/**
 * Client statuses in which the body **explains** the rejection — validation,
 * conflict and business rule. It is an allowlist, not the whole 4xx range, for
 * two reasons: on a `401`/`403` the cause is the credential and the payload
 * answers nothing; and, these being the statuses reachable without
 * authentication, the open range gave an anonymous caller a 4 KB-per-request
 * write channel into the log store. `404`, `405` and `429` fall out by the same
 * criterion.
 */
const BODY_CAPTURE_STATUSES = new Set([400, 409, 422]);

const SERVER_ERROR_STATUS = 500;

/**
 * Resources whose body is never logged: everything under /api/auth carries a
 * credential (password, refresh token, reset code) and the payload does not
 * help diagnose the rejection — the status and the route already say what
 * happened.
 */
const BODY_CAPTURE_EXCLUDED_RESOURCES = new Set(['auth']);

const URL_SCHEMES = new Set(['http', 'https']);

export const DURATION_ATTRIBUTE = 'oficina.http.server.request.duration_ms';
export const REQUEST_ID_ATTRIBUTE = 'request.id';

interface AuthenticatedUser {
  sub?: string;
  role?: string;
}

type LoggedRequest = Request & { id?: string; user?: AuthenticatedUser };

export function resolveHttpLogLevel(statusCode: number): HttpLogLevel {
  if (statusCode >= 500) {
    return 'error';
  }

  if (statusCode >= 400) {
    return 'warn';
  }

  return 'info';
}

export function resolveCompletionOutcome(
  request: IncomingMessage,
  response: ServerResponse,
  error?: Error,
): CompletionOutcome {
  if (request.readableAborted === true) {
    return 'client_aborted';
  }

  if (response.writableEnded === true) {
    return 'completed';
  }

  return error ? 'transport_error' : 'client_aborted';
}

export function generateRequestId(request: IncomingMessage, response: ServerResponse): string {
  return runSafely(
    'request-id',
    () => {
      const inbound =
        pickHeader(request, REQUEST_ID_HEADER) ?? pickHeader(request, CORRELATION_ID_HEADER);

      const requestId = isReusableRequestId(inbound) ? inbound : randomUUID();

      response.setHeader(REQUEST_ID_HEADER, requestId);

      return requestId;
    },
    randomUUID(),
  );
}

function isReusableRequestId(inbound: string | undefined): inbound is string {
  if (!inbound || !REQUEST_ID_PATTERN.test(inbound)) {
    return false;
  }

  return sanitizeText(inbound) === inbound;
}

/**
 * The probe suppression lives here, not in `autoLogging.ignore`, because
 * `ignore` is evaluated at the **start** of the request, and that would also
 * erase the probe that *fails*, which is exactly the event worth logging.
 * `customLogLevel` sees `res` and silences only the success.
 */
export function resolveAccessLogLevel(
  request: IncomingMessage,
  response: ServerResponse,
  error?: Error,
): HttpLogLevel | 'silent' {
  return runSafely<HttpLogLevel | 'silent'>(
    'level-resolution',
    () => {
      const outcome = resolveCompletionOutcome(request, response, error);

      if (outcome === 'transport_error') {
        return 'error' as const;
      }

      if (outcome === 'client_aborted') {
        return 'warn' as const;
      }

      if (isSuppressedHealthProbe(request, response)) {
        return 'silent' as const;
      }

      return resolveHttpLogLevel(response.statusCode);
    },
    'error',
  );
}

function isSuppressedHealthProbe(request: IncomingMessage, response: ServerResponse): boolean {
  const status = response.statusCode;

  if (status < 200 || status >= 300) {
    return false;
  }

  return isHealthProbePath(resolveRequestPath(request as Request));
}

export function buildAccessLogAttributes(
  request: IncomingMessage,
  response: ServerResponse,
  baseObject: Record<string, unknown>,
  error?: Error,
): Record<string, unknown> {
  return runSafely(
    'access-log',
    () => buildAttributes(request as LoggedRequest, response as Response, baseObject, error),
    {},
  );
}

function buildAttributes(
  request: LoggedRequest,
  response: Response,
  baseObject: Record<string, unknown>,
  error?: Error,
): Record<string, unknown> {
  const outcome = resolveCompletionOutcome(request, response, error);
  const context = getRequestLogContext(response);
  const path = resolveRequestPath(request);

  const attributes: Record<string, unknown> = {
    'http.request.method': request.method,
    'url.path': sanitizeUrlPath(path),
    'url.scheme': resolveScheme(request),
  };

  const route = resolveRoute(request);

  if (route) {
    attributes['http.route'] = route;
  }

  if (outcome === 'completed') {
    attributes['http.response.status_code'] = response.statusCode;
  }

  const query = buildQueryString(request);

  if (query) {
    attributes['url.query'] = query;
  }

  if (request.ip && isIP(request.ip) !== 0) {
    attributes['client.address'] = request.ip;
  }

  const userAgent = pickHeader(request, 'user-agent');

  if (userAgent) {
    attributes['user_agent.original'] = sanitizeText(userAgent, MAX_USER_AGENT_LENGTH);
  }

  if (request.httpVersion) {
    attributes['network.protocol.version'] = request.httpVersion;
  }

  Object.assign(attributes, buildHeaderAttributes(request));
  Object.assign(attributes, buildActorAttributes(request));

  if (context.codeFunctionName) {
    attributes['code.function.name'] = context.codeFunctionName;
  }

  const duration = baseObject[DURATION_ATTRIBUTE];

  if (typeof duration === 'number') {
    attributes[DURATION_ATTRIBUTE] = duration;
  }

  Object.assign(attributes, buildOutcomeAttributes(context, outcome));
  Object.assign(attributes, buildBodyAttributes(request, response, outcome));

  return attributes;
}

function buildOutcomeAttributes(
  context: { errorType?: string; errorMessage?: string },
  outcome: CompletionOutcome,
): Record<string, unknown> {
  if (outcome === 'client_aborted') {
    return { 'error.type': CLIENT_ABORTED_ERROR_TYPE };
  }

  if (outcome === 'transport_error') {
    return { 'error.type': TRANSPORT_ERROR_ERROR_TYPE };
  }

  const attributes: Record<string, unknown> = {};

  if (context.errorType) {
    attributes['error.type'] = context.errorType;
  }

  if (context.errorMessage) {
    attributes['oficina.error.message'] = sanitizeText(context.errorMessage);
  }

  return attributes;
}

function resolveScheme(request: Request): string {
  if (URL_SCHEMES.has(request.protocol)) {
    return request.protocol;
  }

  return (request.socket as { encrypted?: boolean } | undefined)?.encrypted ? 'https' : 'http';
}

function capturesBody(statusCode: number): boolean {
  return BODY_CAPTURE_STATUSES.has(statusCode) || statusCode >= SERVER_ERROR_STATUS;
}

function buildBodyAttributes(
  request: Request,
  response: Response,
  outcome: CompletionOutcome,
): Record<string, unknown> {
  if (outcome !== 'completed' || !capturesBody(response.statusCode)) {
    return {};
  }

  if (!MUTATING_METHODS.has(request.method)) {
    return {};
  }

  const contentType = pickHeader(request, 'content-type');

  if (!contentType || !JSON_CONTENT_TYPE.test(contentType)) {
    return {};
  }

  if (request.body === null) {
    return {};
  }

  const resource = extractResourceSegment(resolveRequestPath(request));

  if (resource !== undefined && BODY_CAPTURE_EXCLUDED_RESOURCES.has(resource)) {
    return {};
  }

  // `serializeBody` returns `undefined` when there is no body to serialize —
  // a request without a body arrives here with `req.body` undefined.
  const serialized = serializeBody(request.body, { resource });

  if (!serialized) {
    return {};
  }

  return {
    'oficina.http.request.body_json': serialized.json,
    ...(serialized.truncated ? { 'oficina.http.request.body_truncated': true } : {}),
  };
}

function buildActorAttributes(request: LoggedRequest): Record<string, unknown> {
  const user = request.user;

  if (!user?.sub) {
    return {};
  }

  return {
    'user.id': user.sub,
    ...(user.role ? { 'user.roles': [user.role] } : {}),
  };
}

function buildHeaderAttributes(request: Request): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};

  for (const header of ALLOWED_REQUEST_HEADERS) {
    const value = request.headers[header];

    if (value === undefined) {
      continue;
    }

    const values = Array.isArray(value) ? value : [value];

    attributes[`http.request.header.${header}`] = values.map((entry) =>
      sanitizeText(entry, MAX_HEADER_VALUE_LENGTH),
    );
  }

  return attributes;
}

function resolveRoute(request: Request): string | undefined {
  const routePath = request.route?.path as string | undefined;

  if (!routePath) {
    return undefined;
  }

  return `${request.baseUrl ?? ''}${routePath}`;
}

function pickHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
