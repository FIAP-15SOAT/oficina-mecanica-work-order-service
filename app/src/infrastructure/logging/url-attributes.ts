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
 * Trecho contíguo de escapes percentuais bem formados, agrupado para que um
 * caractere multibyte (`%C3%A9`) seja decodificado de uma vez. Um `%ZZ` não casa
 * o padrão, então divide o trecho e sobrevive literal sem levar o resto junto.
 */
const PERCENT_SEQUENCE = /(?:%[0-9A-Fa-f]{2})+/g;

/**
 * Passes de decodificação antes de varrer. Mais de um porque `%2540` decodifica
 * para `%40`, que ainda não tem forma de arroba: com uma passagem só, um e-mail
 * duplamente codificado atravessava o scrubber. O teto existe para que o
 * trabalho continue proporcional ao limite.
 */
const MAX_DECODE_PASSES = 3;

export const ENCODED_MARKER = '[ENCODED]';

/**
 * `fatal: false` é o que impede a decodificação de falhar aberta.
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
 * A query precisa da mesma canonicalização do caminho, e não só ele: o Express
 * decodifica **uma vez**, então um valor duplamente codificado chega ao
 * classificador ainda sem forma reconhecível — `aaa%2Ebbb%2Eccc` não tem forma
 * de JWT — e o `encodeURIComponent` da saída o reintroduz no log. Aplicar aqui
 * mantém uma política de URL só, para caminho e query.
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
 * Decodifica até estabilizar e **falha fechada** se ainda estiver mudando no teto.
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
 * Corta na fronteira entre parâmetros, para não deixar um escape percentual
 * pela metade no valor registrado.
 */
function fitQueryString(query: string): string {
  if (query.length <= MAX_URL_QUERY_LENGTH) {
    return query;
  }

  const clipped = query.slice(0, MAX_URL_QUERY_LENGTH);
  const boundary = clipped.lastIndexOf('&');

  return boundary > 0 ? clipped.slice(0, boundary) : clipped;
}
