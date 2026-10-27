export type FieldClassification = 'secret' | 'pii' | 'clear';

/**
 * Any run of characters that is neither a letter nor a digit (`_`, `-`, `.`,
 * space, `/`). It becomes a separator, so `api_key`, `api-key`, `api.key` and
 * `api key` produce exactly the same tokens.
 */
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/**
 * camelCase boundary: a lowercase letter or digit followed by an uppercase one.
 * `$1 $2` reinserts both captured groups with a space between them,
 * so `userId` → `user Id` and `zipCode2` stays intact until the next pair.
 */
const CAMEL_BOUNDARY = /([\p{Ll}\p{N}])(\p{Lu})/gu;

/**
 * Acronym boundary: the last uppercase letter followed by uppercase+lowercase.
 * Without it, `APIKey` would become the single token `apikey` and escape the
 * `['api', 'key']` rule. With it, `APIKey` → `API Key` → `['api', 'key']`.
 */
const ACRONYM_BOUNDARY = /(\p{Lu})(\p{Lu}\p{Ll})/gu;

export const MAX_FIELD_NAME_LENGTH = 128;

/**
 * Splits a field name into the token sequence used by the rules below.
 *
 * Classification is by **token sequence**, never by substring — that is what
 * keeps `monkey` and `passenger` out of the `['key']`/`['password']` rules,
 * while catching `apiKey`, `API_KEY` and `api-key` with a single rule.
 *
 * `normalize('NFKC')` (Unicode Normalization Form KC — compatibility +
 * composition) runs first to close the **compatibility** variants: without it,
 * full-width `ｐａｓｓｗｏｒｄ` would not match `password` and the secret value
 * would go out in the clear.
 */
export function tokenize(name: string): string[] {
  return splitTokens(boundFieldName(name));
}

function boundFieldName(name: string): string {
  return name.slice(0, MAX_FIELD_NAME_LENGTH).normalize('NFKC');
}

/**
 * The cut lives **here**, not in the callers, so no future path can bypass it —
 * both tokenization entry points go through this function.
 */
function splitTokens(name: string): string[] {
  const bounded = name.slice(0, MAX_FIELD_NAME_LENGTH);

  if (!bounded) {
    return [];
  }

  return bounded
    .replace(ACRONYM_BOUNDARY, '$1 $2')
    .replace(CAMEL_BOUNDARY, '$1 $2')
    .replace(NON_ALPHANUMERIC, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter((token) => token.length > 0);
}

/**
 * Sequences that mark a secret. They match at **any position** of the name,
 * because `userPasswordHash` and `dbConnectionStringValue` are still secrets,
 * and the value is **removed** from the log, not masked.
 */
export const SECRET_SEQUENCES: readonly (readonly string[])[] = [
  ['password'],
  ['token'],
  ['secret'],
  ['authorization'],
  ['credential'],
  ['api', 'key'],
  ['connection', 'string'],
];

/**
 * Sequences that mark personal data. They match only as a **terminal suffix**,
 * so `customerName` is PII but `nameFormatter` is not. The value is masked
 * preserving its shape, not removed.
 */
export const PII_SEQUENCES: readonly (readonly string[])[] = [
  ['document'],
  ['cpf'],
  ['cnpj'],
  ['email'],
  ['phone'],
  ['zip', 'code'],
  ['cep'],
  ['street'],
  ['address'],
  ['plate'],
  ['name'],
];

/**
 * Neutral qualifiers that only describe the **shape** of the value, never what
 * it is. Because the personal-data rule matches only as a terminal suffix, one
 * of them at the end of the name defeated the whole classification:
 * `phoneNumber` — the canonical English field name — tokenizes into
 * `['phone','number']`, whose terminal is `number`, and went out in the clear.
 * The same held for `documentNumber`, `plateNumber` and `zipCodeValue`.
 *
 * They are stripped from the end before the suffix test, never from the start
 * and never down to an empty list: `partNumber` stays `['part']` (not a PII
 * rule) and a field named just `number` stays `['number']`.
 */
export const NEUTRAL_TERMINAL_TOKENS: readonly string[] = ['number', 'value', 'str'];

/**
 * Resources whose root-level `name` is a catalog name (part, service), not a
 * person's name. The exemption is positional on purpose: it applies only at the
 * root and only on these routes, so a nested `customer.name` is still masked.
 */
export const CATALOG_NAME_EXEMPT_RESOURCES: readonly string[] = ['services', 'parts-supplies'];

export interface ClassificationContext {
  resource?: string;
  isRootPosition: boolean;
}

export function extractResourceSegment(urlPath: string): string | undefined {
  const segments = urlPath
    .split('?')[0]
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const [first, second] = segments;

  if (first === 'api') {
    return second;
  }

  return first;
}

export function classifyFieldName(
  name: string,
  context?: ClassificationContext,
): FieldClassification {
  const bounded = boundFieldName(name);

  if (name.length > MAX_FIELD_NAME_LENGTH || bounded.length > MAX_FIELD_NAME_LENGTH) {
    return 'secret';
  }

  const tokens = splitTokens(bounded);

  if (tokens.length === 0) {
    return 'clear';
  }

  if (SECRET_SEQUENCES.some((sequence) => containsSequence(tokens, sequence))) {
    return 'secret';
  }

  if (isExemptCatalogName(tokens, context)) {
    return 'clear';
  }

  const qualified = stripNeutralQualifiers(tokens);

  if (PII_SEQUENCES.some((sequence) => endsWithSequence(qualified, sequence))) {
    return 'pii';
  }

  return 'clear';
}

function stripNeutralQualifiers(tokens: readonly string[]): readonly string[] {
  let end = tokens.length;

  while (end > 1 && NEUTRAL_TERMINAL_TOKENS.includes(tokens[end - 1])) {
    end -= 1;
  }

  return end === tokens.length ? tokens : tokens.slice(0, end);
}

function isExemptCatalogName(tokens: readonly string[], context?: ClassificationContext): boolean {
  return (
    tokens.length === 1 &&
    tokens[0] === 'name' &&
    context !== undefined &&
    context.isRootPosition &&
    context.resource !== undefined &&
    CATALOG_NAME_EXEMPT_RESOURCES.includes(context.resource)
  );
}

export function containsSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  if (sequence.length === 0 || sequence.length > tokens.length) {
    return false;
  }

  for (let start = 0; start <= tokens.length - sequence.length; start += 1) {
    if (sequence.every((token, offset) => tokens[start + offset] === token)) {
      return true;
    }
  }

  return false;
}

export function endsWithSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  if (sequence.length === 0 || sequence.length > tokens.length) {
    return false;
  }

  const start = tokens.length - sequence.length;

  return sequence.every((token, offset) => tokens[start + offset] === token);
}
