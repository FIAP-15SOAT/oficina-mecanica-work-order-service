import {
  classifyFieldName,
  extractResourceSegment,
} from '@infrastructure/logging/redaction/field-classifier';
import {
  MAX_FIELD_NAME_LENGTH,
  tokenize,
} from '@infrastructure/logging/redaction/field-classifier';

describe('tokenize', () => {
  it('should split camelCase, snake_case, kebab-case and dotted names into the same tokens', () => {
    expect(tokenize('apiKey')).toEqual(['api', 'key']);
    expect(tokenize('api_key')).toEqual(['api', 'key']);
    expect(tokenize('api-key')).toEqual(['api', 'key']);
    expect(tokenize('api.key')).toEqual(['api', 'key']);
  });

  it('should split acronym boundaries', () => {
    expect(tokenize('CPFDocument')).toEqual(['cpf', 'document']);
    expect(tokenize('userCPF')).toEqual(['user', 'cpf']);
  });

  it.each([
    ['APIKey', ['api', 'key']],
    ['APIKeyURLValue', ['api', 'key', 'url', 'value']],
    ['ABcDEf', ['a', 'bc', 'd', 'ef']],
    ['ÁÉName', ['áé', 'name']],
    ['API', ['api']],
  ])('should preserve acronym tokenization for %s', (name, expected) => {
    expect(tokenize(name)).toEqual(expected);
  });

  it('should return an empty sequence for an empty name', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('classifyFieldName', () => {
  const anywhere = { isRootPosition: false };

  it('should mask a name when no classification context is supplied', () => {
    expect(classifyFieldName('name')).toBe('pii');
    expect(classifyFieldName('name', undefined)).toBe('pii');
  });

  it.each([
    'password',
    'passwordHash',
    'refreshToken',
    'accessToken',
    'authorization',
    'clientSecret',
    'credential',
  ])('should classify %s as secret', (name) => {
    expect(classifyFieldName(name, anywhere)).toBe('secret');
  });

  it.each(['apiKey', 'api_key', 'api-key', 'api.key', 'externalApiKeyValue'])(
    'should classify the composed secret %s as secret',
    (name) => {
      expect(classifyFieldName(name, anywhere)).toBe('secret');
    },
  );

  it.each(['connectionString', 'connection_string', 'db.connection.string'])(
    'should classify the composed secret %s as secret',
    (name) => {
      expect(classifyFieldName(name, anywhere)).toBe('secret');
    },
  );

  it.each([
    'document',
    'cpf',
    'cnpj',
    'email',
    'customerEmail',
    'phone',
    'zipCode',
    'zip_code',
    'cep',
    'street',
    'address',
    'billingAddress',
    'plate',
    'name',
  ])('should classify %s as personal data', (name) => {
    expect(classifyFieldName(name, anywhere)).toBe('pii');
  });

  it.each(['monkey', 'passenger', 'city', 'state', 'description', 'quantity', 'code', 'status'])(
    'should not classify %s',
    (name) => {
      expect(classifyFieldName(name, anywhere)).toBe('clear');
    },
  );

  it('should give secret precedence over personal data', () => {
    expect(classifyFieldName('emailPassword', anywhere)).toBe('secret');
    expect(classifyFieldName('tokenName', anywhere)).toBe('secret');
  });

  it('should match a secret sequence at any position and personal data only as a suffix', () => {
    expect(classifyFieldName('tokenIssuedAt', anywhere)).toBe('secret');
    expect(classifyFieldName('addressLookupCount', anywhere)).toBe('clear');
  });

  it('should keep the root name of an exempt catalog resource clear', () => {
    expect(classifyFieldName('name', { resource: 'services', isRootPosition: true })).toBe('clear');
    expect(classifyFieldName('name', { resource: 'parts-supplies', isRootPosition: true })).toBe(
      'clear',
    );
  });

  it('should mask a nested name even on an exempt catalog resource', () => {
    expect(classifyFieldName('name', { resource: 'services', isRootPosition: false })).toBe('pii');
  });

  it('should mask the root name of a resource that is not exempt', () => {
    expect(classifyFieldName('name', { resource: 'customers', isRootPosition: true })).toBe('pii');
    expect(classifyFieldName('name', { resource: 'suppliers', isRootPosition: true })).toBe('pii');
  });

  it('should not extend the exemption to composed name fields', () => {
    expect(classifyFieldName('supplierName', { resource: 'services', isRootPosition: true })).toBe(
      'pii',
    );
  });
});

describe('extractResourceSegment', () => {
  it('should read the resource after the global prefix', () => {
    expect(extractResourceSegment('/api/services')).toBe('services');
    expect(extractResourceSegment('/api/parts-supplies/123')).toBe('parts-supplies');
  });

  it('should read the first segment when there is no global prefix', () => {
    expect(extractResourceSegment('/customers/123')).toBe('customers');
  });

  it('should ignore the query string', () => {
    expect(extractResourceSegment('/api/quotes?page=1')).toBe('quotes');
  });

  it('should return undefined for the root path', () => {
    expect(extractResourceSegment('/')).toBeUndefined();
  });
});

describe('classifyFieldName — name without any token', () => {
  it.each(['', '---', '   '])('should classify %p as clear', (name) => {
    expect(classifyFieldName(name)).toBe('clear');
  });
});

/**
 * Classification runs on every payload key — a field name is client-controlled
 * content. The cut in the tokenizer keeps the cost proportional to the limit
 * even with the linear acronym boundary.
 */
describe('tokenize — cost bounded by the field name', () => {
  it('should bound the field name before splitting it', () => {
    const oversized = 'A'.repeat(MAX_FIELD_NAME_LENGTH * 4);

    const startedAt = process.hrtime.bigint();
    const tokens = tokenize(oversized);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    expect(tokens.join('')).toHaveLength(MAX_FIELD_NAME_LENGTH);
    expect(elapsedMs).toBeLessThan(50);
  });

  it('should still classify a secret whose name sits inside the bound', () => {
    expect(classifyFieldName(`${'a'.repeat(50)}Password`, { isRootPosition: false })).toBe(
      'secret',
    );
  });

  /**
   * Cutting before classifying failed open: the sensitive token fell outside the
   * compared part and the value went out in the clear. Above the cap the
   * classification is closed, and the cost stays bounded because nothing is
   * tokenized.
   */
  it('should fail closed for a name longer than the bound', () => {
    expect(classifyFieldName(`${'a'.repeat(MAX_FIELD_NAME_LENGTH + 2)}Password`)).toBe('secret');
    expect(classifyFieldName('k'.repeat(MAX_FIELD_NAME_LENGTH + 1))).toBe('secret');
  });

  it('should keep classifying a name exactly at the bound', () => {
    expect(classifyFieldName('a'.repeat(MAX_FIELD_NAME_LENGTH))).toBe('clear');
  });
});

/**
 * The personal-data rule matches as a terminal suffix, so a neutral qualifier at
 * the end defeated the whole classification — including `phoneNumber`, the
 * canonical English field name.
 */
describe('classifyFieldName — qualificador terminal neutro', () => {
  it.each([
    'phoneNumber',
    'phone_number',
    'contactPhoneNumber',
    'documentNumber',
    'cpfNumber',
    'plateNumber',
    'zipCodeValue',
    'customerEmailStr',
  ])('should classify %s as personal data', (name) => {
    expect(classifyFieldName(name)).toBe('pii');
  });

  it.each(['partNumber', 'number', 'value', 'nameFormatter', 'invoiceNumber'])(
    'should keep %s clear',
    (name) => {
      expect(classifyFieldName(name)).toBe('clear');
    },
  );

  it('should not let a neutral qualifier override the secret precedence', () => {
    expect(classifyFieldName('apiKeyValue')).toBe('secret');
    expect(classifyFieldName('passwordStr')).toBe('secret');
  });

  it('should keep the catalog exemption on the exact approved position', () => {
    const context = { isRootPosition: true, resource: 'services' };

    expect(classifyFieldName('name', context)).toBe('clear');
    expect(classifyFieldName('name', { isRootPosition: false, resource: 'services' })).toBe('pii');
  });
});

/**
 * NFKC **expands**: 128 times `Ⅷ` (U+2167) become 512 uppercase letters. With
 * the cut applied only before normalization, tokenization would see 4x the
 * agreed size again. The limit must also apply to the expanded form.
 */
describe('tokenize — NFKC must not break the limit', () => {
  const EXPANDING_CHARACTER = 'Ⅷ';

  it('should bound the token stream after normalization, not before it', () => {
    const expanding = EXPANDING_CHARACTER.repeat(MAX_FIELD_NAME_LENGTH);

    expect(expanding.normalize('NFKC').length).toBeGreaterThan(MAX_FIELD_NAME_LENGTH);
    expect(tokenize(expanding).join('')).toHaveLength(MAX_FIELD_NAME_LENGTH);
  });

  /**
   * Cutting the expanded form alone would fail open — it would lose a
   * `...Password` at the end of the name. The classifier decides: over the limit,
   * it is a secret.
   */
  it('should fail closed when normalization pushes the name past the bound', () => {
    const expanding = EXPANDING_CHARACTER.repeat(MAX_FIELD_NAME_LENGTH);

    expect(classifyFieldName(expanding, { isRootPosition: false })).toBe('secret');
  });

  it('should keep an ascii name of exactly the bound classifiable', () => {
    expect(classifyFieldName('a'.repeat(MAX_FIELD_NAME_LENGTH), { isRootPosition: false })).toBe(
      'clear',
    );
  });

  it('should keep the cost proportional to the bound across many keys', () => {
    const keys = Array.from(
      { length: 300 },
      (_, index) => `${EXPANDING_CHARACTER.repeat(MAX_FIELD_NAME_LENGTH - 4)}${index}`,
    );

    const startedAt = process.hrtime.bigint();

    for (const key of keys) {
      classifyFieldName(key, { isRootPosition: false });
    }

    expect(Number(process.hrtime.bigint() - startedAt) / 1e6).toBeLessThan(150);
  });
});
