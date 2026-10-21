import { IncomingMessage, ServerResponse } from 'node:http';

import {
  buildAccessLogAttributes,
  DURATION_ATTRIBUTE,
  generateRequestId,
  resolveAccessLogLevel,
} from '@infrastructure/logging/access-log.builder';
import {
  CLIENT_ABORTED_ERROR_TYPE,
  TRANSPORT_ERROR_ERROR_TYPE,
} from '@infrastructure/logging/access-log.builder';
import { LIVENESS_PATH, READINESS_PATH } from '@infrastructure/health/health.constants';
import {
  MAX_HEADER_VALUE_LENGTH,
  MAX_URL_PATH_LENGTH,
  MAX_USER_AGENT_LENGTH,
} from '@infrastructure/logging/redaction/text-sanitizer';
import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';
import { assignRequestLogContext } from '@infrastructure/logging/request-log-context';
import { captureDiagnostics } from '../../../helpers/diagnostics-capture';

interface FakeRequestOptions {
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  route?: string;
  body?: unknown;
  ip?: string;
  user?: { sub: string; role: string };
  readableAborted?: boolean;
}

function createRequest(options: FakeRequestOptions = {}): IncomingMessage {
  return {
    id: 'req-1',
    method: options.method ?? 'GET',
    path: options.path ?? '/api/customers',
    url: options.path ?? '/api/customers',
    protocol: 'http',
    httpVersion: '1.1',
    ip: options.ip ?? '10.1.2.3',
    headers: options.headers ?? {},
    query: options.query ?? {},
    body: options.body,
    route: options.route ? { path: options.route } : undefined,
    baseUrl: '',
    user: options.user,
    readableAborted: options.readableAborted ?? false,
  } as unknown as IncomingMessage;
}

function createResponse(statusCode = 200, writableEnded = true): ServerResponse {
  return { statusCode, writableEnded, locals: {} } as unknown as ServerResponse;
}

describe('generateRequestId', () => {
  it('should reuse a valid inbound x-request-id and echo it back', () => {
    const setHeader = jest.fn();
    const request = createRequest({ headers: { 'x-request-id': 'abc-123' } });

    const requestId = generateRequestId(request, { setHeader } as unknown as ServerResponse);

    expect(requestId).toBe('abc-123');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'abc-123');
  });

  it('should fall back to x-correlation-id when x-request-id is absent', () => {
    const request = createRequest({ headers: { 'x-correlation-id': 'corr-1' } });

    expect(generateRequestId(request, { setHeader: jest.fn() } as unknown as ServerResponse)).toBe(
      'corr-1',
    );
  });

  it('should prefer x-request-id when both correlation headers are present', () => {
    const request = createRequest({
      headers: { 'x-request-id': 'primary', 'x-correlation-id': 'secondary' },
    });

    expect(generateRequestId(request, { setHeader: jest.fn() } as unknown as ServerResponse)).toBe(
      'primary',
    );
  });

  it('should replace a malformed inbound identifier with a generated one', () => {
    const request = createRequest({ headers: { 'x-request-id': 'inválido com espaço' } });

    const requestId = generateRequestId(request, {
      setHeader: jest.fn(),
    } as unknown as ServerResponse);

    expect(requestId).not.toBe('inválido com espaço');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should replace an oversized inbound identifier', () => {
    const request = createRequest({ headers: { 'x-request-id': 'a'.repeat(200) } });

    expect(
      generateRequestId(request, { setHeader: jest.fn() } as unknown as ServerResponse),
    ).toHaveLength(36);
  });

  /**
   * O charset aceita ponto, hífen e underscore — o alfabeto de um JWT. Um token
   * assinado curto cabia nos 128 caracteres e era ecoado ao cliente e gravado em
   * toda linha da requisição sem passar por varredura de conteúdo.
   */
  it('should reject an inbound identifier the content scrubber would rewrite', () => {
    const shortJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLWN1cnRhLWFxdWk';
    const setHeader = jest.fn();
    const request = createRequest({ headers: { 'x-request-id': shortJwt } });

    const requestId = generateRequestId(request, { setHeader } as unknown as ServerResponse);

    expect(requestId).not.toBe(shortJwt);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', requestId);
  });

  it('should reject an inbound identifier carrying a formatted document', () => {
    const request = createRequest({ headers: { 'x-request-id': '123.456.789-09' } });

    expect(
      generateRequestId(request, { setHeader: jest.fn() } as unknown as ServerResponse),
    ).not.toBe('123.456.789-09');
  });

  it('should reuse the base64 request identifier written by the API Gateway', () => {
    const gatewayRequestId = 'DW7LdhXYIAMESCA=';
    const setHeader = jest.fn();
    const request = createRequest({ headers: { 'x-request-id': gatewayRequestId } });

    const requestId = generateRequestId(request, { setHeader } as unknown as ServerResponse);

    expect(requestId).toBe(gatewayRequestId);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', gatewayRequestId);
  });

  it('should still reuse an ordinary correlation identifier', () => {
    const request = createRequest({ headers: { 'x-request-id': 'pedido-12345-retry-2' } });

    expect(generateRequestId(request, { setHeader: jest.fn() } as unknown as ServerResponse)).toBe(
      'pedido-12345-retry-2',
    );
  });
});

describe('resolveAccessLogLevel', () => {
  it.each([
    [200, 'info'],
    [301, 'info'],
    [401, 'warn'],
    [403, 'warn'],
    [422, 'warn'],
    [500, 'error'],
    [503, 'error'],
  ])('should map status %s to %s', (status, level) => {
    expect(resolveAccessLogLevel(createRequest(), createResponse(status))).toBe(level);
  });

  /**
   * O `pino-http` fabrica um `Error` a partir do status em todo 5xx concluído,
   * então "existe err" não distingue falha de transporte de resposta normal. O
   * estado do socket distingue — e é o que decide aqui.
   */
  it('should ignore a synthetic error when the response completed normally', () => {
    expect(
      resolveAccessLogLevel(createRequest(), createResponse(200), new Error('sintético')),
    ).toBe('info');
  });

  it('should keep a completed 5xx at error level even without an error argument', () => {
    expect(resolveAccessLogLevel(createRequest(), createResponse(500))).toBe('error');
  });

  it('should classify an incomplete response carrying an error as a transport failure', () => {
    expect(
      resolveAccessLogLevel(createRequest(), createResponse(200, false), new Error('ECONNRESET')),
    ).toBe('error');
  });

  it('should not classify an aborted request as a success', () => {
    const aborted = createRequest({ readableAborted: true });

    expect(resolveAccessLogLevel(aborted, createResponse(200, false))).toBe('warn');
  });

  /**
   * Aborto de cliente chega ora por `res.on('close')` (sem `err`), ora por
   * `res.on('error')` (com `err`) — quem dispara primeiro remove os outros. O
   * nível não pode oscilar entre `warn` e `error` conforme essa corrida.
   */
  it('should classify an aborted request the same way with and without an error argument', () => {
    const aborted = createRequest({ readableAborted: true });

    expect(resolveAccessLogLevel(aborted, createResponse(200, false))).toBe('warn');
    expect(
      resolveAccessLogLevel(aborted, createResponse(200, false), new Error('ECONNRESET')),
    ).toBe('warn');
  });

  it('should fall back to error level when resolution itself throws', () => {
    const stderr = captureDiagnostics();

    expect(resolveAccessLogLevel(undefined as unknown as IncomingMessage, createResponse())).toBe(
      'error',
    );
    expect(stderr.spy).toHaveBeenCalled();

    stderr.restore();
  });
});

describe('resolveAccessLogLevel — health routes', () => {
  it.each([LIVENESS_PATH, READINESS_PATH])('should silence a healthy probe on %s', (path) => {
    expect(resolveAccessLogLevel(createRequest({ path }), createResponse(200))).toBe('silent');
  });

  it('should preserve the line when a probe reports unavailability', () => {
    expect(
      resolveAccessLogLevel(createRequest({ path: READINESS_PATH }), createResponse(503)),
    ).toBe('error');
  });

  it('should preserve the line when the client aborts a probe', () => {
    const aborted = createRequest({ path: READINESS_PATH, readableAborted: true });

    expect(resolveAccessLogLevel(aborted, createResponse(200, false))).toBe('warn');
  });

  it('should not change the level derived for a business route', () => {
    expect(
      resolveAccessLogLevel(createRequest({ path: '/api/customers' }), createResponse(200)),
    ).toBe('info');
  });

  it.each(['/api/health-admin', '/api/health/liveness', '/api/healthy'])(
    'should not silence the neighbouring path %s',
    (path) => {
      expect(resolveAccessLogLevel(createRequest({ path }), createResponse(200))).toBe('info');
    },
  );

  it('should not silence a trailing-slash variant the router still accepts', () => {
    expect(
      resolveAccessLogLevel(createRequest({ path: `${LIVENESS_PATH}/` }), createResponse(200)),
    ).toBe('info');
  });

  it('should silence a healthy probe carrying a query string', () => {
    const request = createRequest({ path: LIVENESS_PATH });

    (request as unknown as { url: string }).url = `${LIVENESS_PATH}?verbose=1`;

    expect(resolveAccessLogLevel(request, createResponse(200))).toBe('silent');
  });

  /**
   * `path` é propriedade do Express, e o predicado recebe o tipo do `node:http`.
   * A queda para `url` cobre a requisição que não atravessou o Express — e como
   * `url` carrega a query string, ela só casa o conjunto fechado quando não há
   * nenhuma, o que erra para o lado de registrar.
   */
  it('should fall back to the raw url when the express path is absent', () => {
    const request = createRequest({ path: LIVENESS_PATH });

    delete (request as unknown as { path?: string }).path;

    expect(resolveAccessLogLevel(request, createResponse(200))).toBe('silent');
  });

  it('should not silence a request carrying neither path nor url', () => {
    const request = createRequest({ path: LIVENESS_PATH });

    delete (request as unknown as { path?: string }).path;
    delete (request as unknown as { url?: string }).url;

    expect(resolveAccessLogLevel(request, createResponse(200))).toBe('info');
  });

  it('should log the line when the suppression predicate itself fails', () => {
    const stderr = captureDiagnostics();
    const request = createRequest({ path: LIVENESS_PATH });

    Object.defineProperty(request, 'path', {
      get: () => {
        throw new Error('predicado quebrado');
      },
    });

    expect(resolveAccessLogLevel(request, createResponse(200))).toBe('error');
    expect(stderr.spy).toHaveBeenCalled();

    stderr.restore();
  });
});

describe('buildAccessLogAttributes', () => {
  it('should build the semantic convention attributes for a successful request', () => {
    const request = createRequest({
      method: 'GET',
      path: '/api/customers/123',
      route: '/api/customers/:id',
      headers: { 'user-agent': 'jest', 'accept-language': 'pt-BR' },
    });

    const attributes = buildAccessLogAttributes(request, createResponse(200), {
      [DURATION_ATTRIBUTE]: 12,
    });

    expect(attributes).toMatchObject({
      'http.request.method': 'GET',
      'http.route': '/api/customers/:id',
      'http.response.status_code': 200,
      'url.path': '/api/customers/123',
      'url.scheme': 'http',
      'client.address': '10.1.2.3',
      'user_agent.original': 'jest',
      'network.protocol.version': '1.1',
      'http.request.header.accept-language': ['pt-BR'],
      [DURATION_ATTRIBUTE]: 12,
    });
  });

  it('should omit the route template when no route matched', () => {
    const attributes = buildAccessLogAttributes(
      createRequest({ path: '/api/unknown' }),
      createResponse(404),
      {},
    );

    expect(attributes).not.toHaveProperty('http.route');
    expect(attributes['url.path']).toBe('/api/unknown');
  });

  it('should carry the actor built from the final request user', () => {
    const request = createRequest({ user: { sub: 'user-1', role: 'ADMIN' } });

    const attributes = buildAccessLogAttributes(request, createResponse(403), {});

    expect(attributes['user.id']).toBe('user-1');
    expect(attributes['user.roles']).toEqual(['ADMIN']);
  });

  it('should not carry an actor on an anonymous request', () => {
    const attributes = buildAccessLogAttributes(createRequest(), createResponse(200), {});

    expect(attributes).not.toHaveProperty('user.id');
    expect(attributes).not.toHaveProperty('user.roles');
  });

  it('should only log allowlisted request headers', () => {
    const request = createRequest({
      headers: { authorization: 'Bearer abc', cookie: 'a=b', 'content-type': 'application/json' },
    });

    const attributes = buildAccessLogAttributes(request, createResponse(200), {});

    expect(attributes['http.request.header.content-type']).toEqual(['application/json']);
    expect(Object.keys(attributes)).not.toContain('http.request.header.authorization');
    expect(JSON.stringify(attributes)).not.toContain('Bearer abc');
  });

  it('should sanitize the query string and drop a capability token', () => {
    const request = createRequest({
      path: '/api/quotes/1/decisions',
      query: { token: 'signed.jwt.value', page: '2' },
    });

    const attributes = buildAccessLogAttributes(request, createResponse(401), {});

    expect(attributes['url.query']).toBe('page=2');
    expect(JSON.stringify(attributes)).not.toContain('signed.jwt.value');
  });

  it('should read the resolved error from the request context, not from the status', () => {
    const response = createResponse(500);
    assignRequestLogContext(response, {
      errorType: 'DatabaseOperationException',
      errorMessage: 'conexão perdida',
    });

    const attributes = buildAccessLogAttributes(createRequest(), response, {});

    expect(attributes['error.type']).toBe('DatabaseOperationException');
    expect(attributes['oficina.error.message']).toBe('conexão perdida');
  });

  it('should carry the handler written by the interceptor', () => {
    const response = createResponse(200);
    assignRequestLogContext(response, { codeFunctionName: 'CustomerController.create' });

    expect(buildAccessLogAttributes(createRequest(), response, {})['code.function.name']).toBe(
      'CustomerController.create',
    );
  });

  it('should record an aborted request with the abort outcome and no status code', () => {
    const request = createRequest({ readableAborted: true });

    const attributes = buildAccessLogAttributes(request, createResponse(200, false), {});

    expect(attributes['error.type']).toBe(CLIENT_ABORTED_ERROR_TYPE);
    expect(attributes).not.toHaveProperty('http.response.status_code');
  });

  it('should capture the sanitized body on a 4xx of a mutating JSON request', () => {
    const request = createRequest({
      method: 'POST',
      path: '/api/customers',
      headers: { 'content-type': 'application/json' },
      body: { name: 'Maria Silva', document: '123.456.789-09' },
    });

    const attributes = buildAccessLogAttributes(request, createResponse(422), {});

    expect(attributes['oficina.http.request.body_json']).toBe(
      '{"name":"Ma***va","document":"***.***.789-09"}',
    );
  });

  it('should not capture the body on a successful request', () => {
    const request = createRequest({
      method: 'POST',
      path: '/api/customers',
      headers: { 'content-type': 'application/json' },
      body: { name: 'Maria Silva' },
    });

    expect(buildAccessLogAttributes(request, createResponse(201), {})).not.toHaveProperty(
      'oficina.http.request.body_json',
    );
  });

  it('should not capture the body of a non-mutating request', () => {
    const request = createRequest({
      method: 'GET',
      headers: { 'content-type': 'application/json' },
      body: { name: 'Maria Silva' },
    });

    expect(buildAccessLogAttributes(request, createResponse(404), {})).not.toHaveProperty(
      'oficina.http.request.body_json',
    );
  });

  it('should not capture the body of an unrecognized content type', () => {
    const request = createRequest({
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'texto',
    });

    expect(buildAccessLogAttributes(request, createResponse(400), {})).not.toHaveProperty(
      'oficina.http.request.body_json',
    );
  });

  it('should not capture the body of an aborted request', () => {
    const request = createRequest({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { name: 'Maria Silva' },
      readableAborted: true,
    });

    expect(buildAccessLogAttributes(request, createResponse(400, false), {})).not.toHaveProperty(
      'oficina.http.request.body_json',
    );
  });

  it('should never emit a raw url representation', () => {
    const request = createRequest({
      path: '/api/quotes/1/decisions',
      query: { token: 'signed.jwt.value' },
    });

    const attributes = buildAccessLogAttributes(request, createResponse(200), {});

    expect(attributes).not.toHaveProperty('url.full');
    expect(attributes).not.toHaveProperty('req');
    expect(JSON.stringify(attributes)).not.toContain('signed.jwt.value');
  });
});

describe('resolveLoggerConfig', () => {
  it('should fall back to info and warn on an unknown log level', () => {
    const config = resolveLoggerConfig({ LOG_LEVEL: 'verbose' });

    expect(config.level).toBe('info');
    expect(config.warnings).toHaveLength(1);
  });

  it('should accept silent as a valid level', () => {
    expect(resolveLoggerConfig({ LOG_LEVEL: 'silent' }).level).toBe('silent');
  });

  it('should trust no proxy when the list is absent', () => {
    expect(resolveLoggerConfig({}).trustedProxies).toBe(false);
  });

  it('should hand the proxy list to Express unvalidated, which owns the CIDR grammar', () => {
    const config = resolveLoggerConfig({
      TRUSTED_PROXY_CIDRS: '10.0.0.0/8,not-an-ip',
    });

    expect(config.trustedProxies).toEqual(['10.0.0.0/8', 'not-an-ip']);
    expect(config.warnings).toEqual([]);
  });

  it('should parse a valid proxy list', () => {
    const config = resolveLoggerConfig({
      TRUSTED_PROXY_CIDRS: '10.0.0.0/8, loopback',
    });

    expect(config.trustedProxies).toEqual(['10.0.0.0/8', 'loopback']);
    expect(config.warnings).toHaveLength(0);
  });

  it('should apply every resource default when no variable is set', () => {
    const { resource } = resolveLoggerConfig({});

    expect(resource).toMatchObject({
      'service.name': 'oficina-mecanica-work-order-service',
      'service.namespace': 'oficina-mecanica',
      'service.version': 'dev',
      'deployment.environment.name': 'development',
    });
    expect(resource['service.instance.id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should leave request.id to the logger binding instead of duplicating it', () => {
    const attributes = buildAccessLogAttributes(createRequest(), createResponse(200), {});

    expect(attributes).not.toHaveProperty('request.id');
  });
});

/**
 * Registrar só um nível diferente não basta: o desfecho precisa ser consultável.
 * Uma resposta que nunca chegou ao cliente também não pode carregar status, e
 * muito menos o corpo — `writableEnded` diz que `end()` foi chamado, não que a
 * resposta foi entregue.
 */
describe('buildAccessLogAttributes — desfecho de transporte', () => {
  it('should mark a transport failure with a stable low-cardinality outcome', () => {
    const attributes = buildAccessLogAttributes(
      createRequest(),
      createResponse(200, false),
      {},
      new Error('ECONNRESET'),
    );

    expect(attributes['error.type']).toBe(TRANSPORT_ERROR_ERROR_TYPE);
    expect(attributes).not.toHaveProperty('http.response.status_code');
  });

  it('should mark an aborted request even when an error argument comes along', () => {
    const attributes = buildAccessLogAttributes(
      createRequest({ readableAborted: true }),
      createResponse(200, false),
      {},
      new Error('ECONNRESET'),
    );

    expect(attributes['error.type']).toBe(CLIENT_ABORTED_ERROR_TYPE);
  });

  it('should keep the resolved error of a completed 5xx despite the synthetic error', () => {
    const response = createResponse(500);
    assignRequestLogContext(response, {
      errorType: 'DatabaseOperationException',
      errorMessage: 'conexão perdida',
    });

    const attributes = buildAccessLogAttributes(
      createRequest(),
      response,
      {},
      new Error('failed with status code 500'),
    );

    expect(attributes['error.type']).toBe('DatabaseOperationException');
    expect(attributes['http.response.status_code']).toBe(500);
  });

  it('should not capture the body of a transport failure', () => {
    const request = createRequest({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { name: 'Maria Silva' },
    });

    const attributes = buildAccessLogAttributes(
      request,
      createResponse(500, false),
      {},
      new Error('ECONNRESET'),
    );

    expect(attributes).not.toHaveProperty('oficina.http.request.body_json');
  });
});

describe('buildAccessLogAttributes — casos de borda do corpo e dos cabeçalhos', () => {
  function failingRequest(body: unknown): IncomingMessage {
    return createRequest({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  }

  it('should skip a request that carries no body', () => {
    const attributes = buildAccessLogAttributes(failingRequest(undefined), createResponse(400), {});

    expect(attributes).not.toHaveProperty('oficina.http.request.body_json');
  });

  it('should skip a request whose body is null', () => {
    const attributes = buildAccessLogAttributes(failingRequest(null), createResponse(400), {});

    expect(attributes).not.toHaveProperty('oficina.http.request.body_json');
  });

  it('should flag a truncated body on its own sibling attribute', () => {
    const oversized = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => [`campo${index}`, 'x'.repeat(2048)]),
    );

    const attributes = buildAccessLogAttributes(failingRequest(oversized), createResponse(422), {});

    expect(attributes['oficina.http.request.body_truncated']).toBe(true);
    expect(
      Buffer.byteLength(attributes['oficina.http.request.body_json'] as string),
    ).toBeLessThanOrEqual(4096);
  });

  it('should record a repeated allowlisted header as a string array', () => {
    const request = {
      ...createRequest(),
      headers: { 'accept-language': ['pt-BR', 'en-US'] },
    } as unknown as IncomingMessage;

    expect(buildAccessLogAttributes(request, createResponse(200), {})).toMatchObject({
      'http.request.header.accept-language': ['pt-BR', 'en-US'],
    });
  });

  it('should read the first value of a repeated user-agent header', () => {
    const request = {
      ...createRequest(),
      headers: { 'user-agent': ['jest', 'outro'] },
    } as unknown as IncomingMessage;

    expect(buildAccessLogAttributes(request, createResponse(200), {})).toMatchObject({
      'user_agent.original': 'jest',
    });
  });

  /**
   * Todo atributo semconv que pode faltar é **condicional**: emitir a chave com
   * valor vazio faz o armazenamento indexar um tipo que a convenção não define.
   */
  it('should omit every conditional attribute the request does not carry', () => {
    const bare = {
      method: 'GET',
      headers: {},
      query: {},
      locals: {},
    } as unknown as IncomingMessage;

    const attributes = buildAccessLogAttributes(bare, createResponse(200), {});

    expect(attributes['url.path']).toBe('');
    expect(attributes).not.toHaveProperty('client.address');
    expect(attributes).not.toHaveProperty('user_agent.original');
    expect(attributes).not.toHaveProperty('network.protocol.version');
    expect(attributes).not.toHaveProperty('http.route');
    expect(attributes).not.toHaveProperty('url.query');
    expect(attributes).not.toHaveProperty('oficina.http.server.request.duration_ms');
  });

  it('should fall back to the url when the request exposes no path', () => {
    const request = {
      method: 'POST',
      url: '/api/customers',
      headers: { 'content-type': 'application/json' },
      body: { name: 'Maria Silva' },
      query: {},
    } as unknown as IncomingMessage;

    const attributes = buildAccessLogAttributes(request, createResponse(400), {});

    expect(attributes['url.path']).toBe('/api/customers');
    expect(attributes['oficina.http.request.body_json']).toContain('Ma***va');
  });

  it('should record an actor that carries no role', () => {
    const request = {
      ...createRequest(),
      user: { sub: 'user-1' },
    } as unknown as IncomingMessage;

    const attributes = buildAccessLogAttributes(request, createResponse(200), {});

    expect(attributes['user.id']).toBe('user-1');
    expect(attributes).not.toHaveProperty('user.roles');
  });

  it('should prefix the route template with the mount point when there is one', () => {
    const request = {
      ...createRequest({ route: '/:id' }),
      baseUrl: '/api/customers',
    } as unknown as IncomingMessage;

    expect(buildAccessLogAttributes(request, createResponse(200), {})).toMatchObject({
      'http.route': '/api/customers/:id',
    });
  });

  it('should build the route template when the request exposes no mount point', () => {
    const request = {
      ...createRequest({ route: '/api/customers/:id' }),
      baseUrl: undefined,
    } as unknown as IncomingMessage;

    expect(buildAccessLogAttributes(request, createResponse(200), {})).toMatchObject({
      'http.route': '/api/customers/:id',
    });
  });

  it('should fall back to an empty object when building the attributes throws', () => {
    const stderr = captureDiagnostics();

    expect(
      buildAccessLogAttributes(undefined as unknown as IncomingMessage, createResponse(200), {}),
    ).toEqual({});
    expect(stderr.spy).toHaveBeenCalled();

    stderr.restore();
  });
});

/**
 * Um teto único de 2048 em todo texto era generoso demais para atributos que na
 * prática são curtos. Como o access log também sai em 401, qualquer cliente não
 * autenticado inflava a linha só alongando path, user-agent e headers.
 */
describe('buildAccessLogAttributes — tetos por atributo', () => {
  it('should bound the user agent to its own cap', () => {
    const attributes = buildAccessLogAttributes(
      createRequest({ headers: { 'user-agent': 'U'.repeat(MAX_USER_AGENT_LENGTH * 4) } }),
      createResponse(200),
      {},
    );

    expect(attributes['user_agent.original']).toHaveLength(MAX_USER_AGENT_LENGTH);
  });

  it('should bound an allowlisted header value to its own cap', () => {
    const attributes = buildAccessLogAttributes(
      createRequest({ headers: { 'accept-language': 'x'.repeat(MAX_HEADER_VALUE_LENGTH * 4) } }),
      createResponse(200),
      {},
    );

    expect(attributes['http.request.header.accept-language']).toEqual([
      'x'.repeat(MAX_HEADER_VALUE_LENGTH),
    ]);
  });

  it('should bound the url path to its own cap', () => {
    const attributes = buildAccessLogAttributes(
      createRequest({ path: `/api/${'a'.repeat(MAX_URL_PATH_LENGTH * 4)}` }),
      createResponse(200),
      {},
    );

    expect(attributes['url.path']).toHaveLength(MAX_URL_PATH_LENGTH);
  });

  it('should keep a whole inflated line far below the previous worst case', () => {
    const attributes = buildAccessLogAttributes(
      createRequest({
        path: `/api/${'a'.repeat(4000)}`,
        headers: {
          'user-agent': 'U'.repeat(4000),
          'accept-language': 'x'.repeat(4000),
        },
      }),
      createResponse(401),
      {},
    );

    expect(Buffer.byteLength(JSON.stringify(attributes), 'utf8')).toBeLessThan(2048);
  });
});

/**
 * A captura do corpo é uma **lista de permissão** de status, e não a faixa 4xx
 * inteira: num `401`/`403` a causa é a credencial e o payload não explica nada,
 * e são justamente esses os status que um chamador anônimo alcança — a faixa
 * aberta lhe dava um canal de escrita de 4 KB por requisição no log.
 */
describe('buildAccessLogAttributes — política de captura do corpo', () => {
  function postWithBody(statusCode: number): Record<string, unknown> {
    const request = createRequest({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { nota: 'conteudo-do-corpo' },
    });

    return buildAccessLogAttributes(request, createResponse(statusCode), {});
  }

  it.each([400, 409, 422, 500, 503])('should capture the body on %i', (statusCode) => {
    expect(postWithBody(statusCode)['oficina.http.request.body_json']).toContain(
      'conteudo-do-corpo',
    );
  });

  it.each([401, 403, 404, 405, 429])('should not capture the body on %i', (statusCode) => {
    expect(postWithBody(statusCode)).not.toHaveProperty('oficina.http.request.body_json');
  });

  it('should still not capture the body of a successful request', () => {
    expect(postWithBody(201)).not.toHaveProperty('oficina.http.request.body_json');
  });
});

/**
 * Todo o recurso /api/auth fica fora da captura de corpo, mesmo em status que
 * normalmente capturam (400/409/422): a rota sempre trafega uma credencial
 * (senha, refresh token, código de redefinição), e não há campo isolável por
 * nome sem também apagar zipCode/statusCode do resto do log.
 */
describe('buildAccessLogAttributes — /api/auth nunca captura o corpo', () => {
  function postAuthWithBody(statusCode: number, path: string): Record<string, unknown> {
    const request = createRequest({
      method: 'POST',
      path,
      headers: { 'content-type': 'application/json' },
      body: { code: '123456', newPassword: 'fraca' },
    });

    return buildAccessLogAttributes(request, createResponse(statusCode), {});
  }

  it.each([400, 409, 422, 500])(
    'should not capture the body of a POST to /api/auth/password-reset-confirmations on %i',
    (statusCode) => {
      const attributes = postAuthWithBody(statusCode, '/api/auth/password-reset-confirmations');

      expect(attributes).not.toHaveProperty('oficina.http.request.body_json');
      expect(JSON.stringify(attributes)).not.toContain('123456');
    },
  );

  it('should not capture the body of a POST to /api/auth/login on 400', () => {
    expect(postAuthWithBody(400, '/api/auth/login')).not.toHaveProperty(
      'oficina.http.request.body_json',
    );
  });
});

/**
 * `client.address` e `url.scheme` são os dois únicos valores do access log que o
 * Express deriva de cabeçalho encaminhado sem passar pelo scrubber. Com
 * `trust proxy` ativo ele devolve o primeiro salto não confiável **como texto**,
 * sem exigir que seja um IP, e o `X-Forwarded-Proto` cru.
 */
describe('buildAccessLogAttributes — valores derivados de proxy', () => {
  it.each(['10.1.2.3', '::ffff:10.1.2.3', '2001:db8::1'])(
    'should record %s as the client address',
    (ip) => {
      expect(
        buildAccessLogAttributes(createRequest({ ip }), createResponse(200), {}),
      ).toMatchObject({ 'client.address': ip });
    },
  );

  it.each(['maria.silva@gmail.com', 'Bearer abcdef1234567890', 'unknown'])(
    'should omit a client address that is not an ip (%s)',
    (ip) => {
      expect(
        buildAccessLogAttributes(createRequest({ ip }), createResponse(200), {}),
      ).not.toHaveProperty('client.address');
    },
  );

  it.each(['http', 'https'])('should keep %s as the url scheme', (protocol) => {
    const request = { ...createRequest(), protocol } as unknown as IncomingMessage;

    expect(buildAccessLogAttributes(request, createResponse(200), {})).toMatchObject({
      'url.scheme': protocol,
    });
  });

  it('should fall back to the socket when the forwarded scheme is not a scheme', () => {
    const request = {
      ...createRequest(),
      protocol: 'Bearer abcdef1234567890',
      socket: { encrypted: false },
    } as unknown as IncomingMessage;

    expect(buildAccessLogAttributes(request, createResponse(200), {})).toMatchObject({
      'url.scheme': 'http',
    });
  });

  it('should report https when the socket itself is encrypted', () => {
    const request = {
      ...createRequest(),
      protocol: 'javascript:alert(1)',
      socket: { encrypted: true },
    } as unknown as IncomingMessage;

    expect(buildAccessLogAttributes(request, createResponse(200), {})).toMatchObject({
      'url.scheme': 'https',
    });
  });
});
