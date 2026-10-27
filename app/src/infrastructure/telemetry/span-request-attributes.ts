import { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { Attributes } from '@opentelemetry/api';
import proxyaddr from 'proxy-addr';

import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';
import { runSafely } from '@infrastructure/logging/logging-diagnostics';
import {
  MAX_USER_AGENT_LENGTH,
  REDACTED,
  sanitizeText,
} from '@infrastructure/logging/redaction/text-sanitizer';
import { sanitizeUrlPath } from '@infrastructure/logging/url-attributes';

export function buildIncomingSpanAttributes(request: IncomingMessage): Attributes {
  return runSafely('sanitization', () => buildAttributes(request), buildFailClosedAttributes());
}

function buildFailClosedAttributes(): Attributes {
  return {
    'url.path': REDACTED,
    'url.query': undefined,
    'client.address': undefined,
    'user_agent.original': undefined,
    'server.address': undefined,
    'server.port': undefined,
  };
}

function buildAttributes(request: IncomingMessage): Attributes {
  return {
    'url.path': sanitizeUrlPath(extractRequestPathname(request.url)),
    'url.query': undefined,
    'client.address': resolveClientAddress(request),
    'user_agent.original': resolveUserAgent(request),
    'server.address': undefined,
    'server.port': undefined,
  };
}

export function extractRequestPathname(url: string | null = ''): string {
  if (url === null) {
    return '';
  }

  const queryStart = url.indexOf('?');

  return queryStart === -1 ? url : url.slice(0, queryStart);
}

/**
 * Same resolution as the access line, through the **same** `proxy-addr` Express
 * uses under `req.ip`, fed by the **same** `TRUSTED_PROXY_CIDRS`. It is not
 * duplication by choice: the hook runs on the `http` `emit('request')`, before
 * any middleware, and there the object is still an `IncomingMessage` — `req.ip`
 * does not exist to be reused.
 */
function resolveClientAddress(request: IncomingMessage): string | undefined {
  const address = proxyaddr(request, resolveTrust());

  return address && isIP(address) !== 0 ? address : undefined;
}

let cachedTrustKey: string | undefined;
let cachedTrust: ReturnType<typeof proxyaddr.compile> | undefined;

/**
 * Compiling walks and validates the CIDRs, and this runs per request — hence
 * the memoization, keyed by the configuration itself so an environment change
 * is still observed.
 */
function resolveTrust(): ReturnType<typeof proxyaddr.compile> {
  const { trustedProxies } = resolveLoggerConfig();
  const key = trustedProxies === false ? '' : trustedProxies.join(',');

  if (cachedTrust && cachedTrustKey === key) {
    return cachedTrust;
  }

  cachedTrustKey = key;
  cachedTrust = compileTrust(trustedProxies);

  return cachedTrust;
}

/**
 * `proxyaddr.compile([])` is what Express builds for `trust proxy` off: it
 * trusts no hop and returns the socket address. An invalid list lands in the
 * same place — fail closed, as `applyTrustProxy` does on the other side.
 */
function compileTrust(trustedProxies: string[] | false): ReturnType<typeof proxyaddr.compile> {
  try {
    return proxyaddr.compile(trustedProxies === false ? [] : trustedProxies);
  } catch {
    return proxyaddr.compile([]);
  }
}

function resolveUserAgent(request: IncomingMessage): string | undefined {
  const value = request.headers['user-agent'];

  return value ? sanitizeText(value, MAX_USER_AGENT_LENGTH) : undefined;
}
