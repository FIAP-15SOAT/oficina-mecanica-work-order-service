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
   * O scrubber trabalha sobre a forma do conteúdo, e `%40` não tem a forma de um
   * arroba. Sem canonicalizar antes, o percent-encoding driblava a varredura
   * inteira — a máscara só aparecia quando o cliente não codificava.
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
   * `decodeURIComponent` lança em `%ZZ`. Deixar isso subir faria o `runSafely`
   * do access log devolver `{}` e a linha inteira se perderia por causa de um
   * caminho malformado que o cliente escolheu — por isso a decodificação
   * continua não-lançante. O escape inválido sobrevive literal.
   */
  it('should keep an invalid escape literal instead of throwing', () => {
    expect(sanitizeUrlPath('/api/x/%ZZ%')).toBe('/api/x/%ZZ%');
  });

  /**
   * A versão anterior decodificava a string inteira e devolvia o caminho **cru**
   * no `catch`, então um único `%ZZ` em qualquer posição desligava a
   * canonicalização de tudo: o e-mail em outro segmento chegava legível ao log.
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
   * `%2540` decodifica para `%40`, que ainda não tem forma de arroba: com uma
   * passagem só, um e-mail duplamente codificado atravessava o scrubber inteiro.
   * A varredura roda uma vez, sobre a forma já estável.
   */
  it('should decode until stable so a double-encoded value still gets masked', () => {
    expect(sanitizeUrlPath('/api/users/maria%2540gmail.com')).toBe('/api/users/m***@gmail.com');
  });

  /**
   * `%C3%28` é sintaticamente válido e inválido em UTF-8. Devolver o trecho
   * inteiro cru fazia um único par ruim preservar tudo o que viesse colado nele
   * — um e-mail ou um JWT percent-encoded chegavam íntegros e reversíveis.
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
   * A query também é conteúdo do cliente e podia dominar a linha sozinha: sem
   * teto próprio, cada valor cabia em 2048 caracteres e nada limitava o total.
   * O corte é na fronteira entre parâmetros para não deixar escape pela metade.
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

describe('buildQueryString — requisição sem caminho', () => {
  it('should still classify the query when the request exposes no path', () => {
    const request = { query: { token: 'a', page: '1' } } as unknown as Request;

    expect(buildQueryString(request)).toBe('page=1');
  });

  /**
   * O corte na fronteira de `&` existe para não deixar um escape percentual pela
   * metade. Quando o teto cai **dentro** do primeiro parâmetro não há fronteira
   * onde cortar, e o corte duro é o único resultado possível.
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
 * Decodificar sob um teto de passes fecha a codificação dupla, mas devolver a
 * forma **parcial** ao atingir o teto reabria o furo por outro lado: `%40` fica
 * a uma decodificação de virar `@`, e o e-mail voltava inteiro do log.
 */
describe('sanitizeUrlPath — profundidade de codificação', () => {
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
 * O Express decodifica a query **uma vez**, então um valor duplamente codificado
 * chega ao classificador sem forma reconhecível — e o `encodeURIComponent` da
 * saída o reintroduz no log, de onde duas decodificações recuperam o original.
 */
describe('buildQueryString — canonicalização antes de classificar', () => {
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
