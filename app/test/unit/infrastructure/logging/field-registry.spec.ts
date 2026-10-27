import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { LogEventDefinition } from '@application/logging/log-event';
import { LogFields, LogicalFieldName } from '@application/logging/log-field';
import {
  ALLOWED_REQUEST_HEADERS,
  DECLARED_FIELD_NAMES,
  FIELD_DICTIONARY,
  isDeclaredField,
  LOGICAL_FIELDS,
} from '@infrastructure/logging/field-registry';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

const CATALOGS: Record<string, LogEventDefinition<LogFields>> = {
  ...(BUSINESS_EVENTS as unknown as Record<string, LogEventDefinition<LogFields>>),
  ...(TECHNICAL_EVENTS as unknown as Record<string, LogEventDefinition<LogFields>>),
};

type FieldsOf<TDefinition> =
  TDefinition extends LogEventDefinition<infer TFields> ? keyof TFields : never;

type CatalogFieldName =
  | FieldsOf<(typeof BUSINESS_EVENTS)[keyof typeof BUSINESS_EVENTS]>
  | FieldsOf<(typeof TECHNICAL_EVENTS)[keyof typeof TECHNICAL_EVENTS]>;

type Assert<T extends true> = T;

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Compilation fails in both directions: a logical field declared in the
 * vocabulary that no event emits (a dead entry, like the `previousQuoteStatus`
 * and `dbOperation` left orphaned in the previous version), or a field used by
 * an event that the registry does not know (a log lost at runtime).
 */
type _CatalogMatchesVocabulary = Assert<MutuallyAssignable<CatalogFieldName, LogicalFieldName>>;

describe('field registry', () => {
  it('should derive a dictionary entry for every logical field', () => {
    const missing = Object.values(LOGICAL_FIELDS)
      .map((definition) => definition.key)
      .filter((key) => !DECLARED_FIELD_NAMES.has(key));

    expect(missing).toEqual([]);
  });

  it('should not bind two logical fields to the same physical key', () => {
    const keys = Object.values(LOGICAL_FIELDS).map((definition) => definition.key);

    expect(keys).toHaveLength(new Set(keys).size);
  });

  it('should not declare the same attribute twice', () => {
    const names = FIELD_DICTIONARY.map((definition) => definition.name);

    expect(names).toHaveLength(new Set(names).size);
  });

  it('should not declare a catalog event name twice', () => {
    const names = Object.values(CATALOGS).map((definition) => definition.name);

    expect(names).toHaveLength(new Set(names).size);
  });

  /**
   * The allowlist and the dictionary's `http.request.header.*` entries are two
   * hand-written lists. Adding a header only to the allowlist makes the
   * normalizer drop the attribute **silently**, and the E2E assertion is
   * `keys ⊆ dictionary`, never the reverse — nothing would fail.
   */
  it('should declare a dictionary entry for every allowlisted request header', () => {
    const missing = ALLOWED_REQUEST_HEADERS.filter(
      (header) => !isDeclaredField(`http.request.header.${header}`),
    );

    expect(missing).toEqual([]);
  });

  it('should keep every physical key inside the owned namespace', () => {
    const outside = Object.values(LOGICAL_FIELDS)
      .map((definition) => definition.key)
      .filter((key) => !key.startsWith('oficina.'));

    expect(outside).toEqual([]);
  });

  it('should not declare a logical field named cpf (CPF must never be logged, masked or not)', () => {
    expect(Object.keys(LOGICAL_FIELDS)).not.toContain('cpf');
  });
});
