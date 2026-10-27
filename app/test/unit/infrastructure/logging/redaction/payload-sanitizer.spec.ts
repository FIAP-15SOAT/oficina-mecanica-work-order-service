import {
  CIRCULAR_MARKER,
  MAX_ARRAY_LENGTH,
  MAX_BODY_JSON_BYTES,
  MAX_DEPTH,
  MAX_ENTRIES,
  MAX_KEY_LENGTH,
  sanitizePayload,
  serializeBody,
  TRUNCATED_MARKER,
} from '@infrastructure/logging/redaction/payload-sanitizer';
import { MAX_TEXT_LENGTH, REDACTED } from '@infrastructure/logging/redaction/text-sanitizer';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('sanitizePayload', () => {
  it('should remove a secret at the root', () => {
    const sanitized = sanitizePayload({ email: 'a@b.com', password: 'Tech@2026' }) as Record<
      string,
      unknown
    >;

    expect(sanitized).not.toHaveProperty('password');
    expect(JSON.stringify(sanitized)).not.toContain('Tech@2026');
  });

  it('should remove a secret nested at depth and inside arrays', () => {
    const sanitized = sanitizePayload({
      integrations: [{ label: 'erp', apiKey: 'super-secret-key' }],
      db: { connectionString: 'postgresql://u:p@h/db' },
    });

    expect(JSON.stringify(sanitized)).not.toContain('super-secret-key');
    expect(JSON.stringify(sanitized)).not.toContain('connectionString');
    expect(JSON.stringify(sanitized)).toContain('erp');
  });

  it('should mask a personal container down to every scalar descendant', () => {
    const sanitized = sanitizePayload({
      address: { street: 'Rua das Flores', city: 'São Paulo', state: 'SP', zipCode: '01310-100' },
    }) as { address: Record<string, unknown> };

    expect(sanitized.address).toEqual({
      street: 'Ru***es',
      city: 'Sã***lo',
      state: '***',
      zipCode: '*****-100',
    });
  });

  it('should still remove a secret descendant of a personal container', () => {
    const sanitized = sanitizePayload({
      address: { street: 'Rua das Flores', accessToken: 'abc123' },
    }) as { address: Record<string, unknown> };

    expect(sanitized.address).not.toHaveProperty('accessToken');
    expect(JSON.stringify(sanitized)).not.toContain('abc123');
  });

  it('should mask the root name of a resource that is not exempt', () => {
    const sanitized = sanitizePayload(
      { name: 'Maria Silva', document: '123.456.789-09' },
      { resource: 'customers' },
    );

    expect(sanitized).toEqual({ name: 'Ma***va', document: '***.***.789-09' });
  });

  it('should keep the root name of an exempt catalog resource verbatim', () => {
    const sanitized = sanitizePayload(
      { name: 'Troca de óleo', price: 150 },
      { resource: 'services' },
    );

    expect(sanitized).toEqual({ name: 'Troca de óleo', price: 150 });
  });

  it('should mask a nested name on an exempt catalog resource', () => {
    const sanitized = sanitizePayload(
      { name: 'Troca de óleo', supplier: { name: 'Maria Silva' } },
      { resource: 'services' },
    );

    expect(sanitized).toEqual({ name: 'Troca de óleo', supplier: { name: 'Ma***va' } });
  });

  it('should mask the root name of an unlisted resource', () => {
    const sanitized = sanitizePayload({ name: 'Maria Silva' }, { resource: 'suppliers' });

    expect(sanitized).toEqual({ name: 'Ma***va' });
  });

  it('should preserve free text while masking an embedded document and removing an embedded token', () => {
    const sanitized = sanitizePayload({
      description: `Revisão do cliente 123.456.789-09 com token ${JWT}`,
    });

    expect(sanitized).toEqual({
      description: `Revisão do cliente ***.***.789-09 com token ${REDACTED}`,
    });
  });

  it('should stop at the maximum depth', () => {
    let deep: Record<string, unknown> = { leaf: 'value' };

    for (let level = 0; level < MAX_DEPTH + 2; level += 1) {
      deep = { nested: deep };
    }

    expect(JSON.stringify(sanitizePayload(deep))).toContain(TRUNCATED_MARKER);
  });

  it('should bound array length', () => {
    const sanitized = sanitizePayload({
      items: Array.from({ length: MAX_ARRAY_LENGTH + 10 }, (_, index) => index),
    }) as { items: unknown[] };

    expect(sanitized.items).toHaveLength(MAX_ARRAY_LENGTH + 1);
    expect(sanitized.items[MAX_ARRAY_LENGTH]).toBe(TRUNCATED_MARKER);
  });

  it('should bound the entry count', () => {
    const wide = Object.fromEntries(
      Array.from({ length: MAX_ENTRIES * 2 }, (_, index) => [`field${index}`, index]),
    );

    const sanitized = sanitizePayload(wide) as Record<string, unknown>;

    expect(sanitized[TRUNCATED_MARKER]).toBe(TRUNCATED_MARKER);
    expect(Object.keys(sanitized)).toHaveLength(MAX_ENTRIES + 1);
  });

  it('should stop mid-array once the budget runs out earlier in the walk', () => {
    const filler = Object.fromEntries(
      Array.from({ length: MAX_ENTRIES - 10 }, (_, index) => [`field${index}`, index]),
    );

    const sanitized = sanitizePayload({
      ...filler,
      items: Array.from({ length: MAX_ARRAY_LENGTH }, (_, index) => index),
    }) as { items: unknown[] };

    expect(sanitized.items.length).toBeLessThan(MAX_ARRAY_LENGTH);
    expect(sanitized.items[sanitized.items.length - 1]).toBe(TRUNCATED_MARKER);
  });

  /**
   * The budget must bound the **work**, not just the result. Before, the loop
   * kept classifying every key past the limit, and a key dropped as a secret did
   * not even count — `Object.entries` still fired every getter of the object at
   * once.
   */
  it('should stop reading values once the budget is exhausted', () => {
    const probe: Record<string, unknown> = {};
    let reads = 0;

    for (let index = 0; index < MAX_ENTRIES * 3; index += 1) {
      Object.defineProperty(probe, `field${index}`, {
        enumerable: true,
        get: () => {
          reads += 1;

          return 'value';
        },
      });
    }

    sanitizePayload(probe);

    expect(reads).toBe(MAX_ENTRIES);
  });

  it('should charge the budget for a secret key it discards', () => {
    const secrets = Object.fromEntries(
      Array.from({ length: MAX_ENTRIES * 2 }, (_, index) => [`password_${index}`, 'x']),
    );

    const sanitized = sanitizePayload({ ...secrets, keptField: 'visible' }) as Record<
      string,
      unknown
    >;

    expect(sanitized[TRUNCATED_MARKER]).toBe(TRUNCATED_MARKER);
    expect(sanitized).not.toHaveProperty('keptField');
  });

  it('should detect cycles without infinite recursion', () => {
    const cyclic: Record<string, unknown> = { label: 'root' };
    cyclic.self = cyclic;

    expect(sanitizePayload(cyclic)).toEqual({ label: 'root', self: CIRCULAR_MARKER });
  });

  it('should keep every non-serializable shape inside the closed schema', () => {
    const sanitized = sanitizePayload({
      when: new Date('2026-08-24T10:00:00.000Z'),
      handler: () => undefined,
      marker: Symbol('lote-42'),
      absent: undefined,
      empty: null,
      big: 10n,
    }) as Record<string, unknown>;

    expect(sanitized.when).toBe('2026-08-24T10:00:00.000Z');
    expect(sanitized.handler).toBe(TRUNCATED_MARKER);
    expect(sanitized.marker).toBe('Symbol(lote-42)');
    expect(sanitized.absent).toBeUndefined();
    expect(sanitized.empty).toBeNull();
    expect(sanitized.big).toBe(10n);
  });
});

/**
 * The property name is client-controlled content. Classification read the key
 * to decide how to treat the value, but never treated the key as a value — so a
 * map-shaped payload crossed the whole redaction.
 */
describe('sanitizePayload — property name as content', () => {
  it('should mask a personal identifier used as a property name', () => {
    const sanitized = sanitizePayload({
      'maria.silva@gmail.com': 'x',
      '123.456.789-09': 1,
    }) as Record<string, unknown>;

    expect(Object.keys(sanitized)).toEqual(['ma***va@gmail.com', '***.***.789-09']);
  });

  it('should remove a signed token used as a property name', () => {
    const sanitized = sanitizePayload({ [JWT]: 1 }) as Record<string, unknown>;

    expect(Object.keys(sanitized)).toEqual([REDACTED]);
    expect(JSON.stringify(sanitized)).not.toContain('eyJ');
  });

  it('should leave an ordinary misspelled key untouched, which is the whole diagnostic value', () => {
    const sanitized = sanitizePayload({ nome: 'x', e_mail: 'y', documento: 'z' });

    expect(Object.keys(sanitized as Record<string, unknown>)).toEqual([
      'nome',
      'e_mail',
      'documento',
    ]);
  });

  /**
   * The field-name cap exists to bound the tokenizer's cost, but cutting before
   * classifying failed **open**: the sensitive token fell outside the compared
   * part and the value went out in the clear. Above the cap the classification
   * is closed and the whole entry is dropped.
   */
  it('should drop a field whose name is longer than the classification bound', () => {
    const sanitized = sanitizePayload({ ['k'.repeat(MAX_KEY_LENGTH * 4)]: 1 }) as Record<
      string,
      unknown
    >;

    expect(Object.keys(sanitized)).toEqual([]);
  });

  it('should not let an oversized name hide a secret token past the bound', () => {
    const evasive = `${'a'.repeat(MAX_KEY_LENGTH + 2)}Password`;

    const sanitized = sanitizePayload({ [evasive]: 'S3nh4Secreta!' });

    expect(JSON.stringify(sanitized)).not.toContain('S3nh4Secreta!');
  });

  /**
   * Key collisions remain reachable through **masking**: two distinct e-mails
   * used as keys collapse into the same mask. Overwriting silently would lose a
   * field in exactly the log that exists to explain the rejection.
   */
  it('should not let two keys collapse onto one another after sanitization', () => {
    const sanitized = sanitizePayload({
      'maria.silva@gmail.com': 1,
      'marta.salva@gmail.com': 2,
    }) as Record<string, unknown>;

    expect(Object.keys(sanitized)).toHaveLength(2);
    expect(Object.values(sanitized)).toEqual([1, 2]);
  });

  it('should keep resolving collisions past the second occurrence', () => {
    const sanitized = sanitizePayload({
      'maria.silva@gmail.com': 1,
      'marta.salva@gmail.com': 2,
      'mauro.solva@gmail.com': 3,
    }) as Record<string, unknown>;

    expect(Object.values(sanitized)).toEqual([1, 2, 3]);
  });

  /**
   * `JSON.parse` delivers `__proto__` as an **own** property, and
   * `result[key] = value` would swap the accumulator's prototype instead of
   * creating the entry — the field vanished from the log without warning.
   */
  it('should keep a __proto__ key sent in the payload instead of losing it', () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":1},"tipo":"PJ"}') as Record<
      string,
      unknown
    >;

    const serialized = serializeBody(parsed);

    expect(serialized!.json).toContain('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('serializeBody', () => {
  it('should serialize a small body without truncation', () => {
    const result = serializeBody({ name: 'Maria Silva' }, { resource: 'customers' });

    expect(result).toEqual({ json: '{"name":"Ma***va"}', truncated: false });
  });

  it('should cap the serialized string at 4096 UTF-8 bytes and stay parseable', () => {
    const result = serializeBody({
      notes: Array.from({ length: MAX_ARRAY_LENGTH }, () => 'x'.repeat(500)),
    });

    expect(result).toBeDefined();
    expect(result!.truncated).toBe(true);
    expect(Buffer.byteLength(result!.json, 'utf8')).toBeLessThanOrEqual(MAX_BODY_JSON_BYTES);
    expect(() => {
      JSON.parse(result!.json);
    }).not.toThrow();
  });

  it('should measure the cap in bytes and not in characters', () => {
    const result = serializeBody({ notes: 'ç'.repeat(4000) });

    expect(result!.truncated).toBe(true);
    expect(Buffer.byteLength(result!.json, 'utf8')).toBeLessThanOrEqual(MAX_BODY_JSON_BYTES);
  });

  it('should return nothing when there is no body to serialize', () => {
    expect(serializeBody(undefined)).toBeUndefined();
  });

  /**
   * The flag must cover **every** bound, not just the final byte budget. The
   * string cut is the worst case because it is the only one that leaves no
   * in-band marker: without the flag, a 9 KB field became 2048 characters with no
   * sign that content was missing.
   */
  it('should flag truncation when a long string is cut, even under the byte budget', () => {
    const result = serializeBody({ blob: 'x'.repeat(MAX_TEXT_LENGTH * 4) });

    expect(Buffer.byteLength(result!.json, 'utf8')).toBeLessThanOrEqual(MAX_BODY_JSON_BYTES);
    expect(result!.truncated).toBe(true);
  });

  it('should flag truncation when the depth limit cuts the payload', () => {
    let deep: Record<string, unknown> = { leaf: 'fim' };

    for (let level = 0; level < MAX_DEPTH + 2; level += 1) {
      deep = { nested: deep };
    }

    const result = serializeBody(deep);

    expect(result!.json).toContain(TRUNCATED_MARKER);
    expect(result!.truncated).toBe(true);
  });

  it('should flag truncation when the array limit cuts the payload', () => {
    const result = serializeBody({
      list: Array.from({ length: MAX_ARRAY_LENGTH + 10 }, (_, index) => index),
    });

    expect(result!.json).toContain(TRUNCATED_MARKER);
    expect(result!.truncated).toBe(true);
  });

  it('should flag truncation when the entry budget runs out', () => {
    const wide = Object.fromEntries(
      Array.from({ length: MAX_ENTRIES + 200 }, (_, index) => [`k${index}`, index]),
    );

    expect(serializeBody(wide)!.truncated).toBe(true);
  });

  it('should not flag truncation for a payload that fits every bound', () => {
    const result = serializeBody({ nome: 'ok', lista: [1, 2, 3] });

    expect(result!.truncated).toBe(false);
  });
});

describe('sanitizePayload — scalar value at the root', () => {
  it('should sanitize a scalar value', () => {
    expect(sanitizePayload(`token ${JWT}`)).toBe(`token ${REDACTED}`);
  });
});

describe('sanitizePayload — PII inheritance on a non-text scalar', () => {
  it('should mask a numeric descendant of a personal container', () => {
    const sanitized = sanitizePayload({
      address: { street: 'Rua das Flores', number: 1234, active: true },
    }) as { address: Record<string, unknown> };

    expect(sanitized.address.number).toBe('1***');
    expect(sanitized.address.active).toBe('t***');
  });
});

/**
 * Resolving collisions by restarting the search at `~2` was O(n²): a thousand
 * distinct e-mails masking to the same string took ~500 thousand lookups and
 * 176 ms of event loop — reachable without authentication on `POST
 * /api/auth/login`, which answers `400` and falls in the body-capture list. The
 * budget is loose on purpose; a regression to quadratic time overshoots it by
 * more than an order of magnitude.
 */
describe('serializeBody — cost of resolving colliding keys', () => {
  const BUDGET_MS = 120;

  function collidingKeys(total: number): Record<string, string> {
    return Object.fromEntries(
      Array.from({ length: total }, (_, index) => [
        `ab${'x'.repeat(6)}${index}cd@same.example.com`,
        'v',
      ]),
    );
  }

  it('should keep a payload of colliding keys proportional to its size', () => {
    const payload = collidingKeys(MAX_ENTRIES);

    serializeBody(payload);

    const startedAt = process.hrtime.bigint();

    serializeBody(payload);

    expect(Number(process.hrtime.bigint() - startedAt) / 1e6).toBeLessThan(BUDGET_MS);
  });

  it('should still give every colliding key a distinct deterministic suffix', () => {
    const serialized = serializeBody(collidingKeys(4));
    const keys = Object.keys(JSON.parse(serialized!.json) as Record<string, unknown>);

    expect(new Set(keys).size).toBe(4);
    expect(keys.filter((key) => key.includes('~'))).toHaveLength(3);
    expect(serializeBody(collidingKeys(4))!.json).toBe(serialized!.json);
  });

  /**
   * A suffix the payload **already uses** is the only collision the counter does
   * not foresee, and it is what the remaining loop covers. Here the two
   * 11-digit documents mask to the same string, and the third key arrives
   * literally in the `~2` slot the counter would choose.
   */
  it('should skip a suffix the payload itself already occupies', () => {
    const serialized = serializeBody({
      '11122233344': 'a',
      '11***44~2': 'b',
      '11999999944': 'c',
    });

    const keys = Object.keys(JSON.parse(serialized!.json) as Record<string, unknown>);

    expect(keys).toEqual(['11***44', '11***44~2', '11***44~3']);
  });
});
