import type { AddressInfo } from 'net';
import { request as httpRequest, type Server } from 'http';
import request from 'supertest';

import * as payloadSanitizer from '@infrastructure/logging/redaction/payload-sanitizer';

import { DECLARED_FIELD_NAMES, FIELD_DICTIONARY } from '@infrastructure/logging/field-registry';
import { CLIENT_ABORTED_ERROR_TYPE } from '@infrastructure/logging/access-log.builder';

import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { LogCapture, TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';

const ACCESS_LOG_MESSAGE = 'http request';

function accessLines(capture: LogCapture): Record<string, unknown>[] {
  return capture.lines().filter((line) => line.message === ACCESS_LOG_MESSAGE);
}

describe('Structured logging (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let capture: LogCapture;
  let adminAuth: AuthTokens;
  let mechanicAuth: AuthTokens;

  beforeAll(async () => {
    ctx = await setupTestApp({ captureBootstrap: true, withSwagger: true });
    httpServer = ctx.httpServer;
    capture = ctx.logCapture!;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
    adminAuth = await registerAndLogin(
      httpServer,
      { name: 'Admin Log', email: 'admin.log@e2e.test', role: 'ADMIN' },
      ctx.prisma,
    );
    mechanicAuth = await registerAndLogin(
      httpServer,
      { name: 'Mecanico Log', email: 'mecanico.log@e2e.test', role: 'MECHANIC' },
      ctx.prisma,
    );
    capture.clear();
  });

  describe('envelope, resource attributes and correlation', () => {
    it('should emit exactly one access log line per request', async () => {
      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(accessLines(capture)).toHaveLength(1);
    });

    it('should carry the envelope and the resource attributes on every line', async () => {
      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const [line] = accessLines(capture);

      expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(line.level).toBe('info');
      expect(line.message).toBe(ACCESS_LOG_MESSAGE);
      expect(line['service.name']).toBe('oficina-mecanica-work-order-service');
      expect(line['service.namespace']).toBe('oficina-mecanica');
      expect(line['service.version']).toBeDefined();
      expect(line['service.instance.id']).toBeDefined();
      expect(line['deployment.environment.name']).toBeDefined();
      expect(line['oficina.http.server.request.duration_ms']).toEqual(expect.any(Number));
    });

    it('should echo the correlation identifier in the response header', async () => {
      const response = await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(response.headers['x-request-id']).toBeDefined();
      expect(accessLines(capture)[0]['request.id']).toBe(response.headers['x-request-id']);
    });

    it('should expose the correlation header to browser clients', async () => {
      const response = await request(httpServer)
        .get('/api/customers')
        .set('Origin', 'http://localhost:3000')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(response.headers['access-control-expose-headers']).toContain('x-request-id');
    });

    it('should reuse a valid inbound correlation identifier', async () => {
      const response = await request(httpServer)
        .get('/api/customers')
        .set('x-request-id', 'inbound-request-id-1')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(response.headers['x-request-id']).toBe('inbound-request-id-1');
      expect(accessLines(capture)[0]['request.id']).toBe('inbound-request-id-1');
    });

    it('should replace a malformed inbound correlation identifier', async () => {
      const malformed = 'a'.repeat(300);

      const response = await request(httpServer)
        .get('/api/customers')
        .set('x-request-id', malformed)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(response.headers['x-request-id']).not.toBe(malformed);
      expect(accessLines(capture)[0]['request.id']).not.toBe(malformed);
    });

    it('should correlate a business event with the access log of the same request', async () => {
      capture.clear();

      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'admin.log@e2e.test', password: 'Test@2026' })
        .expect(200);

      const [access] = accessLines(capture);
      const businessEvent = capture
        .lines()
        .find((line) => line['oficina.event.name'] === 'auth.authentication.succeeded');

      expect(businessEvent).toBeDefined();
      expect(businessEvent!['request.id']).toBe(access['request.id']);
      expect(businessEvent!['otel.scope.name']).toBe('AuthenticateUserUseCase');
    });

    it('should mask the subject identity the business event carries', async () => {
      capture.clear();

      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'admin.log@e2e.test', password: 'Test@2026' })
        .expect(200);

      const businessEvent = capture
        .lines()
        .find((line) => line['oficina.event.name'] === 'auth.authentication.succeeded')!;

      expect(businessEvent['oficina.auth.subject.email']).not.toBe('admin.log@e2e.test');
      expect(businessEvent['oficina.auth.subject.email']).toContain('***');
      expect(businessEvent['oficina.auth.subject.name']).toContain('***');
      expect(JSON.stringify(capture.lines())).not.toContain('admin.log@e2e.test');
    });
  });

  describe('field dictionary', () => {
    it('should emit no key outside the declared field dictionary', async () => {
      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer).get('/api/customers').expect(401);

      const undeclared = capture
        .lines()
        .flatMap((line) => Object.keys(line))
        .filter((key) => !DECLARED_FIELD_NAMES.has(key));

      expect([...new Set(undeclared)]).toEqual([]);
    });

    /**
     * Boot lines are the path that escapes: pino's `pid`/`hostname`/`time`/`msg`
     * and the `context` that `nestjs-pino` adds only show up when Nest itself
     * logs. Without capturing at least one of them, the dictionary assertion
     * covers neither `renameContext` nor the explicit `base`.
     */
    it('should keep the framework bootstrap output inside the dictionary too', () => {
      const bootstrap = capture.bootstrapLines();

      expect(bootstrap.length).toBeGreaterThan(0);

      const undeclared = bootstrap
        .flatMap((line) => Object.keys(line))
        .filter((key) => !DECLARED_FIELD_NAMES.has(key));

      expect([...new Set(undeclared)]).toEqual([]);
      expect(bootstrap.some((line) => typeof line['otel.scope.name'] === 'string')).toBe(true);
    });

    it('should type every emitted attribute as the dictionary declares', async () => {
      await request(httpServer)
        .post('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Maria Silva', document: '000', type: 'INDIVIDUAL' })
        .expect(400);

      const mismatches = capture
        .lines()
        .flatMap((line) => Object.entries(line))
        .filter(([key, value]) => {
          const declared = FIELD_DICTIONARY.find((field) => field.name === key);

          if (!declared) {
            return false;
          }

          return declared.type === 'string[]'
            ? !Array.isArray(value) || value.some((entry) => typeof entry !== 'string')
            : typeof value !== declared.type;
        })
        .map(([key]) => key);

      expect([...new Set(mismatches)]).toEqual([]);
    });

    it('should never emit the library default request, response or error representations', async () => {
      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      for (const line of capture.lines()) {
        expect(line).not.toHaveProperty('req');
        expect(line).not.toHaveProperty('res');
        expect(line).not.toHaveProperty('err');
        expect(line).not.toHaveProperty('responseTime');
        expect(line).not.toHaveProperty('context');
        expect(line).not.toHaveProperty('reqId');
        expect(line).not.toHaveProperty('pid');
        expect(line).not.toHaveProperty('hostname');
        expect(line).not.toHaveProperty('time');
        expect(line).not.toHaveProperty('msg');
      }
    });

    it('should never emit a header outside the allowlist', async () => {
      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .set('Cookie', 'session=abc123')
        .expect(200);

      const serialized = JSON.stringify(capture.lines());

      expect(serialized).not.toContain('authorization');
      expect(serialized).not.toContain('session=abc123');
      expect(serialized).not.toContain(adminAuth.accessToken);
    });
  });

  describe('framework bootstrap output', () => {
    /**
     * The `forRoutes` declared in `buildLoggerParams` exists only to silence this
     * warning: `nestjs-pino`'s default is the legacy `'*'` wildcard, which with
     * `setGlobalPrefix` becomes `/api/*` and makes Nest warn twice per boot,
     * once per registered middleware.
     *
     * The assertion lives here, and not in a unit spec on the `forRoutes`
     * value, because the warning comes from Nest's router during
     * initialization — comparing the string with itself would prove nothing,
     * and the boot is exactly what the regression would break.
     */
    it('should register the request logger without tripping the legacy route converter', () => {
      const bootstrap = capture.bootstrapLines();

      expect(bootstrap.length).toBeGreaterThan(0);

      const legacyRouteWarnings = bootstrap.filter(
        (line) =>
          typeof line.message === 'string' && line.message.includes('Unsupported route path'),
      );

      expect(legacyRouteWarnings).toEqual([]);
    });
  });

  describe('guards, actor and error attribution', () => {
    it('should log a request rejected by the authentication guard without an error line', async () => {
      await request(httpServer).get('/api/customers').expect(401);

      const [line] = accessLines(capture);

      expect(line['http.response.status_code']).toBe(401);
      expect(line.level).toBe('warn');
      expect(line['error.type']).toBeDefined();

      expect(capture.lines().filter((entry) => entry.level === 'error')).toEqual([]);
      expect(
        capture.lines().filter((entry) => entry['exception.stacktrace'] !== undefined),
      ).toEqual([]);
    });

    it('should keep the actor on a request rejected by the authorization guard', async () => {
      await request(httpServer)
        .post('/api/users')
        .set('Authorization', `Bearer ${mechanicAuth.accessToken}`)
        .send({
          name: 'Novo Usuario',
          email: 'novo.usuario@e2e.test',
          password: 'Test@2026',
          role: 'ADMIN',
        })
        .expect(403);

      const [line] = accessLines(capture);

      expect(line['http.response.status_code']).toBe(403);
      expect(line['user.id']).toBe(mechanicAuth.user.id);
      expect(line['user.roles']).toEqual(['MECHANIC']);
    });

    it('should carry the handler name resolved by the interceptor', async () => {
      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(accessLines(capture)[0]['code.function.name']).toBe('CustomerController.findAll');
    });

    it('should not attribute an actor to an anonymous request', async () => {
      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'admin.log@e2e.test', password: 'Test@2026' })
        .expect(200);

      expect(accessLines(capture)[0]).not.toHaveProperty('user.id');
    });
  });

  describe('payload protection', () => {
    it('should never log the password submitted on a failed login', async () => {
      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'admin.log@e2e.test', password: 'SenhaErrada@2026' })
        .expect(401);

      expect(JSON.stringify(capture.lines())).not.toContain('SenhaErrada@2026');
    });

    /**
     * The body of any /api/auth route is never captured, even on statuses that
     * normally trigger capture (400/409/422) — the reset code is a credential
     * valid for 10 minutes, and no field can be isolated by name-based
     * redaction without also erasing zipCode/statusCode from the rest of the log.
     */
    it('should never log the password reset code, even on a 400 that would otherwise capture the body', async () => {
      await request(httpServer)
        .post('/api/auth/password-reset-confirmations')
        .send({ email: 'alguem@e2e.test', code: '123456', newPassword: 'fraca' })
        .expect(400);

      const [line] = accessLines(capture);

      expect(line['http.response.status_code']).toBe(400);
      expect(line).not.toHaveProperty('oficina.http.request.body_json');
      expect(JSON.stringify(capture.lines())).not.toContain('123456');
    });

    it('should capture the sanitized body on a 4xx of a mutating route', async () => {
      await request(httpServer)
        .post('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Maria Silva', document: '000', type: 'INDIVIDUAL' })
        .expect(400);

      const body = accessLines(capture)[0]['oficina.http.request.body_json'];

      expect(typeof body).toBe('string');
      expect(body as string).not.toContain('Maria Silva');
      expect(JSON.parse(body as string)).toMatchObject({ name: 'Ma***va' });
    });

    /**
     * Body capture is an allowlist of statuses, not the whole 4xx range: on a
     * `401`/`403` the cause is the credential and the payload explains
     * nothing — and those are exactly the statuses an **anonymous** caller
     * reaches, which gave it a 4 KB-per-request write channel into the log
     * store.
     */
    it('should not capture the body of a request rejected before authentication', async () => {
      await request(httpServer)
        .post('/api/customers')
        .send({ name: 'Maria Silva', document: '000', type: 'INDIVIDUAL' })
        .expect(401);

      const [line] = accessLines(capture);

      expect(line['http.response.status_code']).toBe(401);
      expect(line).not.toHaveProperty('oficina.http.request.body_json');
    });

    it('should not capture the body of a request rejected by the authorization guard', async () => {
      await request(httpServer)
        .post('/api/users')
        .set('Authorization', `Bearer ${mechanicAuth.accessToken}`)
        .send({
          name: 'Novo Usuario',
          email: 'novo.usuario@e2e.test',
          password: 'Test@2026',
          role: 'ADMIN',
        })
        .expect(403);

      const [line] = accessLines(capture);

      expect(line['http.response.status_code']).toBe(403);
      expect(line).not.toHaveProperty('oficina.http.request.body_json');
    });

    it('should not capture the body of a successful request', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Troca de óleo',
          description: 'Revisão simples',
          basePrice: 150,
          estimatedTimeMin: 60,
        })
        .expect(201);

      expect(accessLines(capture)[0]).not.toHaveProperty('oficina.http.request.body_json');
    });

    it('should mask a person name and keep a catalog name verbatim', async () => {
      await request(httpServer)
        .post('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Maria Silva', document: '000', type: 'INDIVIDUAL' })
        .expect(400);

      expect(accessLines(capture)[0]['oficina.http.request.body_json']).toContain('Ma***va');

      capture.clear();

      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Troca de óleo', basePrice: -1, estimatedTimeMin: 60 })
        .expect(400);

      expect(accessLines(capture)[0]['oficina.http.request.body_json']).toContain('Troca de óleo');
    });

    it('should mask a nested name even on an exempt catalog route', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Troca de óleo',
          basePrice: 150,
          estimatedTimeMin: 60,
          supplier: { name: 'Maria Silva' },
        })
        .expect(400);

      const body = accessLines(capture)[0]['oficina.http.request.body_json'] as string;

      expect(body).toContain('Troca de óleo');
      expect(body).toContain('Ma***va');
      expect(body).not.toContain('Maria Silva');
    });

    /**
     * The property name is client-controlled content: a map-shaped payload
     * crossed the whole redaction, because classification read the key but
     * never treated it as a value.
     */
    it('should sanitize a personal identifier sent as a property name', async () => {
      await request(httpServer)
        .post('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ 'maria.silva@gmail.com': 'x', name: 'Maria Silva' })
        .expect(400);

      const serialized = JSON.stringify(capture.lines());

      expect(serialized).not.toContain('maria.silva@gmail.com');
      expect(accessLines(capture)[0]['oficina.http.request.body_json']).toContain(
        'ma***va@gmail.com',
      );
    });

    it('should keep an ordinary misspelled key readable, which is why the body is captured', async () => {
      await request(httpServer)
        .post('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ nome: 'Maria Silva', documento: '123' })
        .expect(400);

      const body = accessLines(capture)[0]['oficina.http.request.body_json'] as string;

      expect(body).toContain('nome');
      expect(body).toContain('documento');
    });

    /**
     * `%40` does not have the shape of an at sign, so without canonicalizing
     * the path, percent-encoding slipped past the whole scrubber.
     */
    it('should catch a percent-encoded personal identifier in the path', async () => {
      await request(httpServer)
        .get('/api/customers/maria.silva%40gmail.com')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(400);

      const serialized = JSON.stringify(capture.lines());

      expect(serialized).not.toContain('maria.silva@gmail.com');
      expect(serialized).not.toContain('maria.silva%40gmail.com');
    });

    /**
     * Decoding was all-or-nothing: `decodeURIComponent` throws on `%ZZ` and the
     * `catch` returned the raw path, so a single invalid escape turned off
     * canonicalization for every other segment.
     */
    it('should keep canonicalizing the path when one escape is invalid', async () => {
      // The Express 5 router rejects the invalid escape with an error that
      // carries `status: 400`. Before the filter recognized that status, the
      // same path resolved to `500` and also emitted an `ERROR` line with a stack.
      await request(httpServer)
        .get('/api/%ZZ/maria.silva%40gmail.com')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(400);

      const serialized = JSON.stringify(capture.lines());

      expect(serialized).not.toContain('maria.silva@gmail.com');
      expect(serialized).not.toContain('maria.silva%40gmail.com');
      expect(
        capture.lines().filter((line) => line['oficina.event.name'] === 'http.request.failed'),
      ).toHaveLength(0);
    });

    it('should never log a capability token carried in the query string', async () => {
      const token = 'eyJhbGciOiJIUzI1NiJ9.eyJxdW90ZUlkIjoiMSJ9.c2lnbmF0dXJlLXZhbHVlLWhlcmU';

      await request(httpServer).get(`/api/customers?token=${token}`).expect(401);

      const serialized = JSON.stringify(capture.lines());

      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain('eyJ');
      expect(accessLines(capture)[0]).not.toHaveProperty('url.query');
    });
  });

  describe('route template and coverage boundary', () => {
    it('should carry the low-cardinality route template for different identifiers', async () => {
      const first = '00000000-0000-4000-8000-000000000001';
      const second = '00000000-0000-4000-8000-000000000002';

      await request(httpServer)
        .get(`/api/customers/${first}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);

      await request(httpServer)
        .get(`/api/customers/${second}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);

      const routes = accessLines(capture).map((line) => line['http.route']);

      expect(routes).toEqual(['/api/customers/:id', '/api/customers/:id']);
    });

    // NestJS 12 mounts its 404 only under the global prefix; outside it Express
    // answered an HTML 404, which the DAST flags as an unexpected content type.
    it('should answer a path outside the global prefix with the JSON 404 envelope', async () => {
      const res = await request(httpServer).get('/rota-fora-do-prefixo').expect(404);

      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Recurso não encontrado.',
      });
    });

    it('should omit the route template when no route matched', async () => {
      await request(httpServer).get('/api/rota-inexistente').expect(404);

      const [line] = accessLines(capture);

      expect(line).not.toHaveProperty('http.route');
      expect(line['url.path']).toBe('/api/rota-inexistente');
    });

    /**
     * Nest's automatic 404 builds the message from `request.originalUrl`, query
     * included — it reached `oficina.error.message` whole and reintroduced into
     * the log the raw URL that `url.query` exists to keep out.
     */
    it('should not reintroduce the raw url through the framework 404 message', async () => {
      await request(httpServer)
        .get('/api/rota-inexistente?token=segredo-opaco-do-parceiro&page=2')
        .expect(404);

      const [line] = accessLines(capture);

      expect(line['oficina.error.message']).toBe('Cannot GET /api/rota-inexistente?page=2');
      expect(JSON.stringify(capture.lines())).not.toContain('segredo-opaco-do-parceiro');
    });

    it('should keep the business message of a 404 raised by a real handler', async () => {
      await request(httpServer)
        .get('/api/customers/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);

      expect(accessLines(capture)[0]['oficina.error.message']).toContain('não encontrado');
    });

    /**
     * Nest's `initMessage()` turns class-validator's `string[]` into
     * `"Bad Request Exception"`, and the real cause of the rejection — the API's
     * most common 4xx — never reached the log.
     */
    it('should carry the real validation messages on a rejected payload', async () => {
      await request(httpServer)
        .post('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Maria Silva', document: '000', type: 'INDIVIDUAL' })
        .expect(400);

      const message = accessLines(capture)[0]['oficina.error.message'] as string;

      expect(message).not.toBe('Bad Request Exception');
      expect(message.length).toBeGreaterThan(0);
    });

    it('should not log a request rejected by the body parser', async () => {
      await request(httpServer)
        .post('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .set('Content-Type', 'application/json')
        .send('{ malformed json')
        .expect(400);

      expect(accessLines(capture)).toHaveLength(0);
    });

    /**
     * `body-parser` throws `http-errors`, which carry `status` but are not
     * `HttpException`. Without recognizing that, a body above 100 kB became a
     * `500` and the filter emitted an `ERROR` line with a stack — with no
     * authentication, no `request.id` and no sibling access log, because the
     * request dies before the middleware. It was the same class of noise this
     * change came to fix.
     */
    it('should answer 413 for an oversized body without emitting an error line', async () => {
      await request(httpServer)
        .post('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ name: 'x'.repeat(200_000) }))
        .expect(413);

      expect(accessLines(capture)).toHaveLength(0);
      expect(
        capture.lines().filter((line) => line['oficina.event.name'] === 'http.request.failed'),
      ).toHaveLength(0);
    });

    it('should not log a CORS preflight request', async () => {
      await request(httpServer)
        .options('/api/customers')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(accessLines(capture)).toHaveLength(0);
    });

    /**
     * Swagger registers its handlers directly on the Express adapter, before
     * everything Nest's `init()` adds — so `/api/docs` never reaches the logging
     * middleware. That boundary is what makes the ~13 000 probe lines a day
     * simply not exist, with no suppression mechanism.
     */
    it('should not log a documentation request served by swagger', async () => {
      await request(httpServer).get('/api/docs/').expect(200);

      expect(accessLines(capture).filter((line) => line['url.path'] === '/api/docs/')).toEqual([]);
    });

    it('should not log the openapi document either', async () => {
      await request(httpServer).get('/api/docs-json').expect(200);

      expect(accessLines(capture)).toEqual([]);
    });
  });

  describe('failure handling', () => {
    it('should emit exactly one error line with a stack for a 5xx', async () => {
      const failing = jest
        .spyOn(ctx.prisma.customer, 'findMany')
        .mockRejectedValue(new Error('conexão perdida com o banco'));

      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(500);

      const dedicated = capture
        .lines()
        .filter((line) => line['oficina.event.name'] === 'http.request.failed');

      expect(dedicated).toHaveLength(1);
      expect(dedicated[0].level).toBe('error');
      expect(dedicated[0]['exception.stacktrace']).toBeDefined();
      expect(dedicated[0]['exception.message']).toBe('conexão perdida com o banco');

      const [access] = accessLines(capture);

      expect(access.level).toBe('error');
      expect(access['error.type']).toBe('Error');
      expect(access['oficina.error.message']).toBe('conexão perdida com o banco');

      failing.mockRestore();
    });

    it('should keep a committed operation and its response intact when the sanitizer throws', async () => {
      const created = await request(httpServer)
        .post('/api/parts-supplies')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Filtro de Óleo',
          sku: `FO-LOG-${Date.now()}`,
          category: 'PART',
          unit: 'UN',
          costPrice: 10,
          salePrice: 20,
          stock: 10,
          minStock: 1,
        })
        .expect(201);

      const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
      const sanitizer = jest.spyOn(payloadSanitizer, 'sanitizePayload').mockImplementation(() => {
        throw new Error('sanitizer failure');
      });

      let response: request.Response;

      try {
        response = await request(httpServer)
          .patch(`/api/parts-supplies/${created.body.data.id}`)
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .send({ type: 'ENTRY', quantity: 5, reason: 'Reposição' });
      } finally {
        sanitizer.mockRestore();
      }

      expect(response.status).toBe(200);
      expect(response.body.data.stock).toBe(15);

      const persisted = await ctx.prisma.partSupply.findUnique({
        where: { id: created.body.data.id },
      });

      expect(persisted?.stock).toBe(15);
      expect(String(stderr.mock.calls.map((call) => call[0]).join(''))).toContain(
        '"message":"logging failure"',
      );

      stderr.mockRestore();
    });

    it('should not record an aborted request as a success', async () => {
      const delayed = jest.spyOn(ctx.prisma.customer, 'findMany').mockImplementation(
        (() =>
          new Promise((resolve) => {
            setTimeout(() => resolve([]), 1500);
          })) as never,
      );

      if (!httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.listen(0, resolve));
      }

      const { port } = httpServer.address() as AddressInfo;

      capture.clear();

      await new Promise<void>((resolve) => {
        const clientRequest = httpRequest({
          host: '127.0.0.1',
          port,
          path: '/api/customers',
          method: 'GET',
          headers: { Authorization: `Bearer ${adminAuth.accessToken}` },
        });

        clientRequest.on('error', () => resolve());
        clientRequest.end();

        setTimeout(() => clientRequest.destroy(), 200);
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const [line] = accessLines(capture);

      expect(line).toBeDefined();
      expect(line.level).not.toBe('info');
      expect(line['error.type']).toBe(CLIENT_ABORTED_ERROR_TYPE);
      expect(line).not.toHaveProperty('http.response.status_code');

      delayed.mockRestore();
    });
  });
});
