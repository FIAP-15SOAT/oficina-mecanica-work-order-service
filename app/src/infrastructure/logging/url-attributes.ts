import { Request } from 'express';

import { extractResourceSegment } from './redaction/field-classifier';
import { sanitizePayload } from './redaction/payload-sanitizer';
import {
  MAX_URL_PATH_LENGTH,
  MAX_URL_QUERY_LENGTH,
  sanitizeText,
  truncateText,
} from './redaction/text-sanitizer';

/**
 * Contiguous run of well-formed percent escapes, grouped so a multibyte
 * character (`%C3%A9`) is decoded at once. A `%ZZ` does not match the pattern,
 * so it splits the run and survives literally without taking the rest along.
 */
const PERCENT_SEQUENCE = /(?:%[0-9A-Fa-f]{2})+/g;

/**
 * Decoding passes before scanning. More than one because `%2540` decodes to
 * `%40`, which still has no at-sign shape: with a single pass, a double-encoded
 * e-mail crossed the scrubber. The cap keeps the work proportional to the
 * limit.
 */
const MAX_DECODE_PASSES = 3;

export const ENCODED_MARKER = '[ENCODED]';

/**
 * `fatal: false` is what keeps the decoding from failing open.
 */
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });

/**
 * Full request path. Express strips a router's mount point from `path` (it moves
 * to `baseUrl`), and NestJS 12 answers the 404 from a router mounted at the global
 * prefix: without `baseUrl` the line lost `/api`.
 */
export function resolveRequestPath(
  request: Partial<Pick<Request, 'baseUrl' | 'path' | 'url'>>,
): string {
  return `${request.baseUrl ?? ''}${request.path ?? request.url ?? ''}`;
}

export function sanitizeUrlPath(path: string): string {
  return sanitizeText(canonicalize(truncateText(path, MAX_URL_PATH_LENGTH)), MAX_URL_PATH_LENGTH);
}

export function buildQueryString(request: Request): string | undefined {
  const query = request.query as Record<string, unknown> | undefined;

  if (!query || Object.keys(query).length === 0) {
    return undefined;
  }

  const sanitized = sanitizePayload(canonicalizeValue(query), {
    resource: extractResourceSegment(request.path ?? ''),
  }) as Record<string, unknown>;

  const parts: string[] = [];

  for (const [key, value] of Object.entries(sanitized)) {
    if (value === undefined || value === null) {
      continue;
    }

    for (const entry of Array.isArray(value) ? value : [value]) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(entry))}`);
    }
  }

  return parts.length > 0 ? fitQueryString(parts.join('&')) : undefined;
}

/**
 * The query needs the same canonicalization as the path, not only the path:
 * Express decodes **once**, so a double-encoded value reaches the classifier
 * still without a recognizable shape — `aaa%2Ebbb%2Eccc` has no JWT shape — and
 * the output's `encodeURIComponent` puts it back into the log. Applying it here
 * keeps a single URL policy for path and query.
 */
function canonicalizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return canonicalize(truncateText(value, MAX_URL_QUERY_LENGTH));
  }

  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        canonicalizeValue(entry),
      ]),
    );
  }

  return value;
}

/**
 * Decodes until stable and **fails closed** if it is still changing at the cap.
 */
function canonicalize(value: string): string {
  let current = value;

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const decoded = decodePercentRuns(current);

    if (decoded === current) {
      return current;
    }

    current = decoded;
  }

  return current.replace(PERCENT_SEQUENCE, ENCODED_MARKER);
}

function decodePercentRuns(value: string): string {
  return value.replace(PERCENT_SEQUENCE, decodePercentRun);
}

function decodePercentRun(run: string): string {
  const bytes = new Uint8Array(run.length / 3);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16);
  }

  return UTF8_DECODER.decode(bytes);
}

/**
 * Cuts at a parameter boundary, so no percent escape is left half-cut in the
 * logged value.
 */
function fitQueryString(query: string): string {
  if (query.length <= MAX_URL_QUERY_LENGTH) {
    return query;
  }

  const clipped = query.slice(0, MAX_URL_QUERY_LENGTH);
  const boundary = clipped.lastIndexOf('&');

  return boundary > 0 ? clipped.slice(0, boundary) : clipped;
}
