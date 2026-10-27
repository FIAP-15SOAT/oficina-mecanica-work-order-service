import { classifyFieldName, MAX_FIELD_NAME_LENGTH } from './field-classifier';
import { maskScalar } from './pii-masker';
import { MAX_TEXT_LENGTH, sanitizeText, truncateText } from './text-sanitizer';

export const MAX_DEPTH = 8;
export const MAX_ENTRIES = 1000;
export const MAX_ARRAY_LENGTH = 50;
export const MAX_KEY_LENGTH = MAX_FIELD_NAME_LENGTH;
export const MAX_BODY_JSON_BYTES = 4096;

export const TRUNCATED_MARKER = '[TRUNCATED]';
export const CIRCULAR_MARKER = '[CIRCULAR]';

export interface SanitizePayloadOptions {
  resource?: string;
}

export interface SerializedBody {
  json: string;
  truncated: boolean;
}

/**
 * `descend` returns a **new** state object by spread, so a scalar field marked
 * in a child node would never reach the parent. `budget` and `truncation` are
 * shared objects on purpose: they are how a cut applied deep in the tree reaches
 * whoever builds the record.
 */
interface SanitizeState {
  depth: number;
  inheritedPii: boolean;
  isRootPosition: boolean;
  seen: Set<object>;
  budget: { entries: number };
  truncation: { applied: boolean };
  resource?: string;
}

interface SanitizeResult {
  value: unknown;
  truncated: boolean;
}

export function sanitizePayload(value: unknown, options: SanitizePayloadOptions = {}): unknown {
  return sanitizeWithBounds(value, options).value;
}

function sanitizeWithBounds(value: unknown, options: SanitizePayloadOptions): SanitizeResult {
  const truncation = { applied: false };

  const sanitized = sanitizeNode(value, {
    depth: 0,
    inheritedPii: false,
    isRootPosition: true,
    seen: new Set<object>(),
    budget: { entries: MAX_ENTRIES },
    truncation,
    resource: options.resource,
  });

  return { value: sanitized, truncated: truncation.applied };
}

/**
 * `truncated` covers **every** bound, not just the final byte budget. Depth,
 * array length, entry budget and string cut also drop content — and the string
 * cut is the only one that leaves no in-band marker, so without this flag a
 * 9 KB `description` became 2048 characters with no sign that anything was
 * missing.
 */
export function serializeBody(
  value: unknown,
  options: SanitizePayloadOptions = {},
): SerializedBody | undefined {
  const sanitized = sanitizeWithBounds(value, options);
  const json = JSON.stringify(sanitized.value);

  if (json === undefined) {
    return undefined;
  }

  if (Buffer.byteLength(json, 'utf8') <= MAX_BODY_JSON_BYTES) {
    return { json, truncated: sanitized.truncated };
  }

  return { json: fitToByteBudget(json), truncated: true };
}

/**
 * Finds, by binary search, the longest JSON prefix that still fits the byte
 * budget **after being wrapped** in the truncation envelope.
 *
 * A `slice(0, MAX_BODY_JSON_BYTES)` does not work for two reasons: in UTF-8 a
 * character can take up to 4 bytes, and the envelope's `JSON.stringify`
 * re-escapes the content, so every `"` or `\` in the prefix can double in size.
 * The final size is not a linear function of the cut, and the binary search
 * converges in ~12 iterations.
 */
function fitToByteBudget(json: string): string {
  let low = 0;
  let high = json.length;
  let best = envelope('');

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = envelope(json.slice(0, middle));

    if (Buffer.byteLength(candidate, 'utf8') <= MAX_BODY_JSON_BYTES) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best;
}

function envelope(content: string): string {
  return JSON.stringify({ _truncated: true, _content: content });
}

/**
 * Bounded depth-first walk over the value to be logged. At each node: classifies
 * the key (a secret is removed, PII is masked), propagates the container's PII
 * mark to every scalar descendant, and runs strings through the content
 * scrubber.
 *
 * The bounds — depth, entry budget, array length, string length and cycle
 * detection — exist so a hostile payload cannot turn sanitization into a denial
 * of service.
 */
function sanitizeNode(value: unknown, state: SanitizeState): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (value.length > MAX_TEXT_LENGTH) {
      markTruncated(state);
    }

    return state.inheritedPii
      ? maskScalar(truncateText(value, MAX_TEXT_LENGTH))
      : sanitizeText(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return state.inheritedPii ? maskScalar(value) : value;
  }

  if (typeof value === 'symbol') {
    return sanitizeText(value.toString());
  }

  if (typeof value === 'function') {
    markTruncated(state);

    return TRUNCATED_MARKER;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (state.depth >= MAX_DEPTH) {
    markTruncated(state);

    return TRUNCATED_MARKER;
  }

  if (state.seen.has(value)) {
    return CIRCULAR_MARKER;
  }

  state.seen.add(value);

  const result = Array.isArray(value) ? sanitizeArray(value, state) : sanitizeObject(value, state);

  state.seen.delete(value);

  return result;
}

function sanitizeArray(value: unknown[], state: SanitizeState): unknown[] {
  const items: unknown[] = [];
  const limit = Math.min(value.length, MAX_ARRAY_LENGTH);

  for (let index = 0; index < limit; index += 1) {
    if (!consumeBudget(state)) {
      items.push(TRUNCATED_MARKER);

      return items;
    }

    items.push(sanitizeNode(value[index], descend(state, false)));
  }

  if (value.length > MAX_ARRAY_LENGTH) {
    markTruncated(state);
    items.push(TRUNCATED_MARKER);
  }

  return items;
}

function sanitizeObject(value: object, state: SanitizeState): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>;
  const occurrences = new Map<string, number>();
  const source = value as Record<string, unknown>;

  for (const key of Object.keys(value)) {
    if (!consumeBudget(state)) {
      result[TRUNCATED_MARKER] = TRUNCATED_MARKER;

      return result;
    }

    const classification = classifyFieldName(key, {
      resource: state.resource,
      isRootPosition: state.isRootPosition,
    });

    if (classification === 'secret') {
      continue;
    }

    assignSanitized(
      result,
      occurrences,
      key,
      sanitizeNode(source[key], descend(state, classification === 'pii')),
    );
  }

  return result;
}

/**
 * The key is classified by its **original** name and only then sanitized by the
 * content shape. The property name is client-controlled content: a map-shaped
 * payload (`{ "maria@x.com": … }`) would cross the whole redaction.
 */
function assignSanitized(
  result: Record<string, unknown>,
  occurrences: Map<string, number>,
  key: string,
  value: unknown,
): void {
  result[resolveUniqueKey(result, occurrences, sanitizeText(key, MAX_KEY_LENGTH))] = value;
}

/**
 * Truncating and masking collapse distinct keys into the same string.
 * Overwriting silently would lose a field in exactly the log that exists to
 * explain the rejection, so the collision becomes a deterministic suffix.
 *
 * The **per-base-key** counter is what keeps this linear. Restarting the search
 * at `~2` on every collision cost O(n²): a thousand distinct e-mails that mask
 * to the same string — reachable without authentication on `POST
 * /api/auth/login`, which answers `400` and falls in the body-capture list —
 * took ~500 thousand lookups and 176 ms of event loop per request, 14x a body of
 * the same size without collisions. With the counter each suffix is tried at
 * most once.
 *
 * The remaining loop exists only for the artificial collision: a legitimate
 * `foo~2` already present in the payload. It also advances the counter, so it
 * does not bring back the quadratic cost.
 */
function resolveUniqueKey(
  result: Record<string, unknown>,
  occurrences: Map<string, number>,
  key: string,
): string {
  const previous = occurrences.get(key);

  if (previous === undefined) {
    occurrences.set(key, 1);

    return key;
  }

  let occurrence = previous + 1;

  while (Object.hasOwn(result, `${key}~${occurrence}`)) {
    occurrence += 1;
  }

  occurrences.set(key, occurrence);

  return `${key}~${occurrence}`;
}

function markTruncated(state: SanitizeState): void {
  state.truncation.applied = true;
}

function consumeBudget(state: SanitizeState): boolean {
  if (state.budget.entries <= 0) {
    markTruncated(state);

    return false;
  }

  state.budget.entries -= 1;

  return true;
}

function descend(state: SanitizeState, inheritsPii: boolean): SanitizeState {
  return {
    ...state,
    depth: state.depth + 1,
    isRootPosition: false,
    inheritedPii: state.inheritedPii || inheritsPii,
  };
}
