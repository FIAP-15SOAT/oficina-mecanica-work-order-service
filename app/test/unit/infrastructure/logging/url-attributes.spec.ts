import { Request } from 'express';

import {
  buildQueryString,
  ENCODED_MARKER,
  resolveRequestPath,
  sanitizeUrlPath,
} from '@infrastructure/logging/url-attributes';
import {
  MAX_URL_PATH_LENGTH,
  MAX_URL_QUERY_LENGTH,
  REDACTED,
} from '@infrastructure/logging/redaction/text-sanitizer';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

function createRequest(path: string, query: Record<string, unknown> = {}): Request {
  return { path, query } as unknown as Request;
}

describe('resolveRequestPath', () => {
  it('should prepend the mount point Express strips inside a mounted router', () => {
    expect(resolveRequestPath({ baseUrl: '/api', path: '/rota-inexistente' })).toBe(
      '/api/rota-inexistente',
    );
  });

  it('should keep the full path of a route registered on the application', () => {
    expect(resolveRequestPath({ baseUrl: '', path: '/api/customers' })).toBe('/api/customers');
  });

  it('should fall back to the raw url when Express did not derive a path', () => {
    expect(resolveRequestPath({ url: '/api/health/live' })).toBe('/api/health/live');
  });

  it('should return an empty path when the request carries none', () => {
    expect(resolveRequestPath({})).toBe('');
  });
});

describe('sanitizeUrlPath', () => {
  it('should keep an ordinary path untouched', () => {
    expect(sanitizeUrlPath('/api/customers/550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/api/customers/550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('should mask a personal identifier written in the path', () => {
    expect(sanitizeUrlPath('/api/customers/123.456.789-09')).toBe('/api/customers/***.***.789-09');
  });

  /**
   * The scrubber works on the content shape, and `%40` does not have the shape of
   * an at sign. Without canonicalizing first, percent-encoding dodged the whole
   * scan — the mask only showed up when the client did not encode.
   */
  it('should catch a percent-encoded e-mail that the raw scan would miss', () => {
    expect(sanitizeUrlPath('/api/users/maria.silva%40gmail.com')).toBe(
      '/api/users/ma***va@gmail.com',
    );
  });

  it('should catch a percent-encoded signed token', () => {
    const encoded = `/api/x/${JWT.split('.').join('%2E')}`;

    expect(sanitizeUrlPath(encoded)).toBe(`/api/x/${REDACTED}`);
  });

  /**
   * `decodeURIComponent` throws on `%ZZ`. Letting that bubble up would make the
   * access log's `runSafely` return `{}` and the whole line would be lost because
   * of a malformed path the client chose — that is why decoding stays
   * non-throwing. The invalid escape survives literally.
   */
  it('should keep an invalid escape literal instead of throwing', () => {
    expect(sanitizeUrlPath('/api/x/%ZZ%')).toBe('/api/x/%ZZ%');
  });

  /**
   * The previous version decoded the whole string and returned the **raw** path
   * in the `catch`, so a single `%ZZ` anywhere turned off canonicalization for
   * everything: the e-mail in another segment reached the log readable.
   */
  it('should still canonicalize the rest of the path when one escape is invalid', () => {
    expect(sanitizeUrlPath('/api/%ZZ/maria.silva%40gmail.com')).toBe('/api/%ZZ/ma***va@gmail.com');
  });

  it('should not let an invalid escape smuggle a capability token through', () => {
    const encoded = `/api/%ZZ/${JWT.replaceAll('.', '%2E')}`;

    expect(sanitizeUrlPath(encoded)).toBe(`/api/%ZZ/${REDACTED}`);
  });

  it('should decode a multi-byte sequence as a single unit', () => {
    expect(sanitizeUrlPath('/api/servi%C3%A7os')).toBe('/api/serviços');
  });

  /**
   * `%2540` decodes to `%40`, which still has no at-sign shape: with a single
   * pass, a double-encoded e-mail crossed the whole scrubber. The scan runs once,
   * over the already stable form.
   */
  it('should decode until stable so a double-encoded value still gets masked', () => {
    expect(sanitizeUrlPath('/api/users/maria%2540gmail.com')).toBe('/api/users/m***@gmail.com');
  });

  /**
   * `%C3%28` is syntactically valid and invalid UTF-8. Returning the whole run
   * raw made a single bad pair preserve everything attached to it — a
   * percent-encoded e-mail or JWT arrived intact and reversible.
   */
  it('should keep decoding past a byte that is not valid utf-8', () => {
    const encoded = [...Buffer.from('maria.silva@gmail.com', 'utf8')]
      .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
      .join('');

    const sanitized = sanitizeUrlPath(`/api/x/%C3%28${encoded}`);

    expect(sanitized).toContain('ma***va@gmail.com');
    expect(sanitized).not.toContain('%6D');
  });

  it('should still decode a valid multibyte sequence as one character', () => {
    expect(sanitizeUrlPath('/api/servi%C3%A7os/revis%C3%A3o')).toBe('/api/serviços/revisão');
  });

  it('should truncate before scanning so the cost stays bounded', () => {
    expect(sanitizeUrlPath(`/api/${'a'.repeat(MAX_URL_PATH_LENGTH * 4)}`)).toHaveLength(
      MAX_URL_PATH_LENGTH,
    );
  });
});

describe('buildQueryString', () => {
  it('should return undefined when there is no query', () => {
    expect(buildQueryString(createRequest('/api/customers'))).toBeUndefined();
  });

  it('should return undefined when the request carries no query object at all', () => {
    expect(buildQueryString({ path: '/api/customers' } as unknown as Request)).toBeUndefined();
  });

  it('should preserve pagination and filter parameters', () => {
    const query = buildQueryString(
      createRequest('/api/customers', { page: '2', limit: '10', search: 'oleo' }),
    );

    expect(query).toBe('page=2&limit=10&search=oleo');
  });

  it('should drop a capability token classified by name', () => {
    expect(
      buildQueryString(createRequest('/api/quotes/1/decisions', { token: JWT })),
    ).toBeUndefined();
  });

  it('should expand a repeated parameter into one pair per value', () => {
    expect(buildQueryString(createRequest('/api/customers', { status: ['OPEN', 'CLOSED'] }))).toBe(
      'status=OPEN&status=CLOSED',
    );
  });

  it('should skip a parameter with no value', () => {
    expect(buildQueryString(createRequest('/api/customers', { page: '1', empty: null }))).toBe(
      'page=1',
    );
  });

  it('should mask a personal parameter while keeping it queryable', () => {
    expect(buildQueryString(createRequest('/api/customers', { document: '123.456.789-09' }))).toBe(
      'document=***.***.789-09',
    );
  });

  /**
   * The query is client content too and could dominate the line alone: without
   * its own cap, each value fit in 2048 characters and nothing bounded the total.
   * The cut is at a parameter boundary so no escape is left half-cut.
   */
  it('should cap the query string at its own bound, cutting on a parameter boundary', () => {
    const query = buildQueryString(
      createRequest(
        '/api/customers',
        Object.fromEntries(
          Array.from({ length: 200 }, (_, index) => [`f${index}`, 'a'.repeat(40)]),
        ),
      ),
    );

    expect(query!.length).toBeLessThanOrEqual(MAX_URL_QUERY_LENGTH);
    expect(query!.endsWith('&')).toBe(false);
    expect(query).not.toContain('&&');
  });
});

describe('buildQueryString — request without a path', () => {
  it('should still classify the query when the request exposes no path', () => {
    const request = { query: { token: 'a', page: '1' } } as unknown as Request;

    expect(buildQueryString(request)).toBe('page=1');
  });

  /**
   * Cutting at the `&` boundary exists so no percent escape is left half-cut.
   * When the cap falls **inside** the first parameter there is no boundary to cut
   * at, and a hard cut is the only possible result.
   */
  it('should hard-clip a single parameter that alone exceeds the bound', () => {
    const query = buildQueryString(
      createRequest('/api/customers', { search: 'a'.repeat(MAX_URL_QUERY_LENGTH * 2) }),
    );

    expect(query).toHaveLength(MAX_URL_QUERY_LENGTH);
    expect(query).not.toContain('&');
  });
});

/**
 * Decoding under a pass cap closes double encoding, but returning the
 * **partial** form when the cap is hit reopened the hole from the other side:
 * `%40` is one decode away from `@`, and the e-mail came back whole from the
 * log.
 */
describe('sanitizeUrlPath — encoding depth', () => {
  it.each([
    '/users/alice%40example.com',
    '/users/alice%2540example.com',
    '/users/alice%252540example.com',
  ])('should decode and mask %s', (path) => {
    expect(sanitizeUrlPath(path)).toBe('/users/a***@example.com');
  });

  it.each(['/users/alice%25252540example.com', '/users/alice%2525252540example.com'])(
    'should fail closed when %s is still decoding at the cap',
    (path) => {
      const sanitized = sanitizeUrlPath(path);

      expect(sanitized).toContain(ENCODED_MARKER);
      expect(sanitized).not.toContain('%40');
      expect(decodeURIComponent(sanitized)).not.toContain('alice@example.com');
    },
  );
});

/**
 * Express decodes the query **once**, so a double-encoded value reaches the
 * classifier without a recognizable shape — and the output's
 * `encodeURIComponent` puts it back into the log, from where two decodes recover
 * the original.
 */
describe('buildQueryString — canonicalization before classifying', () => {
  const jwt = 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc';

  it.each([
    ['sem codificar', jwt],
    ['uma vez', 'aaaaaaaaaa%2Ebbbbbbbbbb%2Ecccccccccc'],
    ['duas vezes', 'aaaaaaaaaa%252Ebbbbbbbbbb%252Ecccccccccc'],
  ])('should redact a jwt encoded %s', (_label, value) => {
    const query = buildQueryString(createRequest('/api/x', { redirect: value }));

    expect(query).toContain(encodeURIComponent(REDACTED));
    expect(decodeURIComponent(decodeURIComponent(query!))).not.toContain(jwt);
  });

  it('should leave an ordinary filter untouched', () => {
    expect(buildQueryString(createRequest('/api/customers', { page: '2', search: 'oleo' }))).toBe(
      'page=2&search=oleo',
    );
  });

  it('should canonicalize inside a repeated parameter', () => {
    const query = buildQueryString(
      createRequest('/api/x', { redirect: ['ok', 'aaaaaaaaaa%252Ebbbbbbbbbb%252Ecccccccccc'] }),
    );

    expect(query).toContain('redirect=ok');
    expect(query).toContain(encodeURIComponent(REDACTED));
  });
});
