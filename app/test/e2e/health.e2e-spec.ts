import type { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';

import { LIVENESS_PATH, READINESS_PATH } from '@infrastructure/health/health.constants';
import { classifyHealthFailure } from '@infrastructure/health/postgres.health-check';
import { HealthFailureCategory } from '@infrastructure/logging/technical-event.catalog';
import { PrismaService } from '@infrastructure/persistence/prisma/prisma.service';

import { AppModule } from '../../src/app.module';
import { OutboxRelayService } from '../../src/infrastructure/messaging/outbox-relay.service';
import { SqsConsumerService } from '../../src/infrastructure/messaging/sqs-consumer.service';
import { configureApp } from '../../src/infrastructure/config/app-bootstrap';

import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { LogCapture, TestContext, setupTestApp } from '../helpers/test-app.helper';

const ACCESS_LOG_MESSAGE = 'http request';
const EVENT_NAME = 'oficina.event.name';

const HEALTH_FAILURE_CATEGORIES = [
  'timeout',
  'connection',
  'pool',
  'authentication',
  'query',
  'unknown',
];

function accessLines(capture: LogCapture): Record<string, unknown>[] {
  return capture.lines().filter((line) => line.message === ACCESS_LOG_MESSAGE);
}

function eventLines(capture: LogCapture, name: string): Record<string, unknown>[] {
  return capture.lines().filter((line) => line[EVENT_NAME] === name);
}

/**
 * `close(signal)` executa os hooks de encerramento de qualquer forma — o
 * `enableShutdownHooks()` apenas registra listeners de sinais do processo, e a
 * suíte não o usa. A interface pública do Nest não declara o parâmetro, mas o
 * `NestApplicationContext` o aceita e o repassa aos hooks.
 */
function closeWithSignal(app: INestApplication, signal: string): Promise<void> {
  return (app as { close(signal?: string): Promise<void> }).close(signal);
}

interface ObservedFailure {
  code: unknown;
  message: unknown;
  category: HealthFailureCategory;
}

/**
 * Consulta direta ao pool parado, pelo mesmo caminho que a verificação usa, só
 * para **documentar a forma** que o driver entrega. Sem isso um `unknown` na
 * linha de transição é mudo: o evento não carrega texto do driver por decisão de
 * segurança, então a asserção da categoria falharia sem dizer o que mudou.
 */
async function observeRawFailure(prisma: PrismaService): Promise<ObservedFailure> {
  let failure: unknown;

  try {
    await prisma.pool.query({ text: 'SELECT 1' });
  } catch (error) {
    failure = error;
  }

  if (failure === undefined) {
    throw new Error('a consulta direta ao banco parado não falhou');
  }

  const shape = failure as { code?: unknown; message?: unknown };

  return {
    code: shape.code,
    message: String(shape.message).slice(0, 160),
    category: classifyHealthFailure(failure),
  };
}

const READINESS_WARMUP_TIMEOUT_MS = 30_000;
const READINESS_WARMUP_INTERVAL_MS = 250;

/**
 * A **primeira** verificação depois do boot paga TCP + autenticação com o pool
 * ainda vazio, e o prazo próprio é de 3,5 s. Numa máquina saturada — doze suítes
 * E2E, cada uma com os próprios containers — esse caso frio estoura o prazo e a
 * prontidão responde `503` uma vez, exatamente como responderia em produção
 * antes de o `failureThreshold` ser atingido.
 *
 * A propriedade continua asserida: se a prontidão **nunca** ficar `200`, esta
 * função falha e derruba a suíte. O que ela remove é a dependência de uma única
 * amostra fria sob inanição de CPU — a latência de partida a frio está medida
 * em `design.md › D10`, e o que os testes abaixo verificam é o **contrato**.
 */
async function waitUntilReady(server: Server): Promise<void> {
  const deadline = Date.now() + READINESS_WARMUP_TIMEOUT_MS;

  for (;;) {
    const response = await request(server).get(READINESS_PATH);

    if (response.status === 200) {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error(`prontidão não assentou em 200; último status: ${response.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, READINESS_WARMUP_INTERVAL_MS));
  }
}

describe('Health endpoints (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let capture: LogCapture;

  beforeAll(async () => {
    ctx = await setupTestApp({ captureLogs: true });
    httpServer = ctx.httpServer;
    capture = ctx.logCapture!;

    await waitUntilReady(httpServer);
  });

  /**
   * O app é fechado pelo último teste, que precisa capturar as linhas do próprio
   * encerramento.
   */
  afterAll(async () => {
    await ctx.postgresContainer.stop();
    await ctx.mailhogContainer.stop();
  });

  beforeEach(() => {
    capture.clear();
  });

  it('should answer liveness without credentials', async () => {
    const response = await request(httpServer).get(LIVENESS_PATH).expect(200);

    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('should answer readiness with the database up', async () => {
    const response = await request(httpServer).get(READINESS_PATH).expect(200);

    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([LIVENESS_PATH, READINESS_PATH])(
    'should emit no access log line for a healthy probe on %s',
    async (path) => {
      await request(httpServer).get(path).expect(200);

      expect(accessLines(capture)).toHaveLength(0);
    },
  );

  it('should keep emitting the access log line for a business route', async () => {
    await request(httpServer).get('/api/customers').expect(401);

    expect(accessLines(capture)).toHaveLength(1);
  });

  it('should not silence a trailing-slash variant the router still accepts', async () => {
    await request(httpServer).get(`${LIVENESS_PATH}/`).expect(200);

    expect(accessLines(capture)).toHaveLength(1);
  });

  it('should emit no transition event while the dependency stays healthy', async () => {
    await request(httpServer).get(READINESS_PATH).expect(200);

    expect(eventLines(capture, 'health.degraded')).toHaveLength(0);
    expect(eventLines(capture, 'health.recovered')).toHaveLength(0);
  });

  /**
   * Precisa ser o **último** teste do **primeiro** `describe` do arquivo, e as
   * duas condições são do `nestjs-pino`: o logger fora de contexto de requisição
   * é um singleton de módulo (`outOfContext`, criado uma única vez), então as
   * linhas de encerramento de qualquer app posterior caem na captura deste
   * primeiro. E o app precisa ser fechado dentro do teste para que a captura o
   * enxergue.
   */
  it('should release the pool before announcing the shutdown as completed', async () => {
    await closeWithSignal(ctx.app, 'SIGTERM');

    const events = capture
      .lines()
      .map((line) => line[EVENT_NAME])
      .filter((name) => name === 'db.disconnected' || name === 'app.shutdown');

    expect(events).toEqual(['db.disconnected', 'app.shutdown']);
  });
});

describe('Health endpoints with the database unreachable (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let capture: LogCapture;
  let failureResponse: request.Response;
  let failureLines: Record<string, unknown>[];
  let observedFailure: ObservedFailure;

  beforeAll(async () => {
    ctx = await setupTestApp({ captureLogs: true });
    httpServer = ctx.httpServer;
    capture = ctx.logCapture!;

    await waitUntilReady(httpServer);

    await ctx.postgresContainer.stop();

    capture.clear();

    failureResponse = await request(httpServer).get(READINESS_PATH);
    failureLines = capture.lines();

    observedFailure = await observeRawFailure(ctx.prisma);
  });

  /**
   * Ordem explícita: depois do `stop()`, o `close()` chama `$disconnect()`
   * contra um servidor morto e essa espera não tem prazo, então ela acontece
   * sozinha e primeiro. Um `stop()` posterior é no-op — o testcontainers memoiza
   * o container parado —, o que também significa que `restart()` não é caminho
   * de recuperação: a transição de recuperação fica coberta pelo unitário.
   */
  afterAll(async () => {
    await ctx.app.close();
    await ctx.mailhogContainer.stop();
    await ctx.postgresContainer.stop();
  });

  it('should report unavailability on readiness while liveness stays successful', async () => {
    await request(httpServer).get(READINESS_PATH).expect(503);
    await request(httpServer).get(LIVENESS_PATH).expect(200);
  });

  it('should answer the same minimal body for the unavailable readiness', () => {
    expect(failureResponse.status).toBe(503);
    expect(failureResponse.body).toEqual({ status: 'unavailable' });
    expect(failureResponse.headers['cache-control']).toBe('no-store');
  });

  it('should not leak infrastructure detail in the unavailable body', () => {
    const body = JSON.stringify(failureResponse.body);

    expect(body).not.toMatch(/postgres|localhost|127\.0\.0\.1|5432|\bat\s/i);
    expect(body).not.toContain('Error');
    expect(body).not.toContain('prisma');
  });

  it('should emit exactly one access log line for the failing probe', () => {
    const lines = failureLines.filter((line) => line.message === ACCESS_LOG_MESSAGE);

    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('error');
    expect(lines[0]['http.response.status_code']).toBe(503);
  });

  /**
   * A resposta `503` é deliberada e o handler não lança, então não há exceção
   * resolvida de onde derivar os atributos de erro — e o `pino-http` sintetiza
   * um `Error` a partir do status que o projeto descarta de propósito. O sistema
   * não os fabrica para preencher o campo.
   */
  it('should omit the error attributes and the stack trace on the deliberate failure', () => {
    const [line] = failureLines.filter((entry) => entry.message === ACCESS_LOG_MESSAGE);

    expect(line['error.type']).toBeUndefined();
    expect(line['oficina.error.message']).toBeUndefined();
    expect(line['exception.stacktrace']).toBeUndefined();
    expect(
      failureLines.filter((entry) => entry[EVENT_NAME] === 'http.request.failed'),
    ).toHaveLength(0);
  });

  it('should emit exactly one degradation event carrying the cause category', () => {
    const degraded = failureLines.filter((line) => line[EVENT_NAME] === 'health.degraded');

    expect(degraded).toHaveLength(1);
    expect(degraded[0].level).toBe('warn');
    expect(degraded[0]['oficina.dependency.name']).toBe('postgresql');
    expect(HEALTH_FAILURE_CATEGORIES).toContain(degraded[0]['oficina.health.failure.category']);

    // Um container parado produz `ECONNREFUSED` — direto ou agregado por família
    // de endereço — ou um `Error` do `pg` de mensagem constante. Todos
    // classificam como `connection`, e nunca como `unknown`.
    expect(degraded[0]['oficina.health.failure.category']).toBe('connection');
  });

  /**
   * Assere sobre o objeto inteiro de propósito: numa divergência o Jest imprime
   * o `code` e a mensagem observados, que é a informação que falta para corrigir
   * o mapeamento sem outra rodada completa da suíte.
   */
  it('should classify the shape the driver actually produces for a dead server', () => {
    expect(observedFailure).toMatchObject({ category: 'connection' });
  });

  it('should not repeat the degradation event while the state does not change', async () => {
    capture.clear();

    await request(httpServer).get(READINESS_PATH).expect(503);
    await request(httpServer).get(READINESS_PATH).expect(503);

    expect(eventLines(capture, 'health.degraded')).toHaveLength(0);
  });

  it('should not leak infrastructure detail in the degradation event', () => {
    const [degraded] = failureLines.filter((line) => line[EVENT_NAME] === 'health.degraded');

    expect(JSON.stringify(degraded)).not.toMatch(/5432|Can't reach|connection string/i);
  });
});

describe('Health endpoints during graceful shutdown (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let previousEnvironment: string | undefined;

  beforeEach(async () => {
    // A janela é sustentada apenas onde existe um plano de dados para propagar a
    // remoção — fora dele ela seria só latência de hot reload. Declarar o
    // ambiente aqui é o que faz esta suíte exercitar o comportamento orquestrado.
    previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    ctx = await setupTestApp();
    httpServer = ctx.httpServer;

    // A janela só é sustentada com sinal real, e o servidor precisa estar
    // escutando de fato para que uma requisição atravesse o encerramento.
    await ctx.app.listen(0);
    await cleanDatabase(ctx.prisma);
    await waitUntilReady(httpServer);
  });

  afterEach(async () => {
    process.env.NODE_ENV = previousEnvironment;

    await ctx.postgresContainer.stop();
    await ctx.mailhogContainer.stop();
  });

  it('should report unavailable readiness and successful liveness during the window', async () => {
    const closing = closeWithSignal(ctx.app, 'SIGTERM');

    await request(httpServer).get(READINESS_PATH).expect(503);
    await request(httpServer).get(LIVENESS_PATH).expect(200);

    await closing;
  });

  /**
   * O **único** teste que prova a ordem de liberação dos recursos. O teste de
   * status acima não prova: com o `$disconnect()` de volta em `onModuleDestroy`,
   * `/ready` responderia `503` pelo estado de `draining` e `/live` `200` de
   * qualquer forma, e os dois passariam. Aqui a consulta real ao banco acontece
   * **depois** de o encerramento começar, então ela falha se o pool tiver sido
   * fechado antes da janela.
   */
  it('should let an in-flight business request reach the database during the window', async () => {
    const auth: AuthTokens = await registerAndLogin(
      httpServer,
      { name: 'Admin Drain', email: 'admin.drain@e2e.test', role: 'ADMIN' },
      ctx.prisma,
    );

    const created = await request(httpServer)
      .post('/api/services')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ name: 'Troca de óleo drain', basePrice: 150.5, estimatedTimeMin: 45 })
      .expect(201);

    const serviceId = created.body.data.id as string;

    const delegate = ctx.prisma.service as unknown as {
      findUnique: (args: unknown) => Promise<unknown>;
    };
    const findUnique = delegate.findUnique.bind(ctx.prisma.service);

    let handlerReached!: () => void;
    const reached = new Promise<void>((resolve) => {
      handlerReached = resolve;
    });

    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    delegate.findUnique = async (args: unknown) => {
      handlerReached();

      await released;

      return findUnique(args);
    };

    const inFlight = request(httpServer)
      .get(`/api/services/${serviceId}`)
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .then((response) => response);

    await reached;

    const closing = closeWithSignal(ctx.app, 'SIGTERM');

    release();

    const response = await inFlight;

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(serviceId);

    delegate.findUnique = findUnique;

    await closing;
  });
});

/**
 * Um endereço que recusa a conexão de imediato. O objetivo não é medir latência,
 * é provar que a porta abre com o banco inalcançável **desde o boot**.
 */
const UNREACHABLE_DATABASE_URL = 'postgresql://nobody:nobody@127.0.0.1:1/nodb';

/**
 * Sobe a aplicação sem infraestrutura alguma — sem containers, sem migration.
 * A composição da borda vem de `configureApp()`, a mesma que o `main.ts` usa,
 * para que a sequência não seja duplicada à mão e volte a divergir — e o
 * `listen()` também: "a porta abre com o banco fora" é a propriedade que este
 * `describe` existe para provar, e sem escutar de fato não há porta a assertar.
 */
async function bootWithoutDatabase(): Promise<NestExpressApplication> {
  // No broker here either: relay and consumer are inert, as in setupTestApp.
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OutboxRelayService)
    .useValue({})
    .overrideProvider(SqsConsumerService)
    .useValue({})
    .compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();

  configureApp(app, { allowedOrigins: true, withSwagger: true });

  await app.init();
  await app.listen(0);

  return app;
}

describe('Health endpoints with the database unavailable from boot (E2E)', () => {
  let app: NestExpressApplication;
  let httpServer: Server;
  let previousDatabaseUrl: string | undefined;

  beforeAll(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = UNREACHABLE_DATABASE_URL;

    app = await bootWithoutDatabase();
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();

    process.env.DATABASE_URL = previousDatabaseUrl;
  });

  /**
   * A propriedade cloud-native que o desenho depende e que nenhum outro teste
   * cobria: o `$connect()` do adapter é preguiçoso, então um pod criado com o
   * banco fora **sobe**, passa no `startupProbe` e se recupera sozinho. Se uma
   * versão futura do adapter passar a validar conectividade no `connect()`, isto
   * vira `CrashLoopBackOff` em produção — e falha aqui primeiro.
   */
  it('should open the port even though the database is unreachable', () => {
    expect(httpServer.listening).toBe(true);
    expect(httpServer.address()).not.toBeNull();
  });

  it('should answer liveness with success while the database is unreachable', async () => {
    const response = await request(httpServer).get(LIVENESS_PATH).expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('should answer readiness with unavailability while the database is unreachable', async () => {
    const response = await request(httpServer).get(READINESS_PATH).expect(503);

    expect(response.body).toEqual({ status: 'unavailable' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  /**
   * O contrato publicado é insumo do scan de DAST e de clientes gerados. Um
   * schema único com os dois valores afirmaria que `/live` pode responder
   * `unavailable` e que o `503` pode responder `ok` — estados que não existem, e
   * que levariam um consumidor a ler o corpo em vez do status.
   */
  describe('published contract', () => {
    let paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    let schemas: Record<string, { properties: { status: { enum: unknown } } }>;

    // O Swagger publica o corpo como `$ref` para `components.schemas`, então a
    // asserção precisa resolver a referência para chegar ao enum real.
    const enumOf = (response: unknown): unknown => {
      const { $ref } = (
        response as { content: { 'application/json': { schema: { $ref: string } } } }
      ).content['application/json'].schema;

      return schemas[$ref.split('/').pop()!].properties.status.enum;
    };

    beforeAll(async () => {
      const document = await request(httpServer).get('/api/docs-json').expect(200);

      paths = document.body.paths as typeof paths;
      schemas = document.body.components.schemas as typeof schemas;
    });

    it('should publish both health paths', () => {
      expect(Object.keys(paths)).toEqual(expect.arrayContaining([LIVENESS_PATH, READINESS_PATH]));
    });

    it('should not declare an unavailable outcome for liveness', () => {
      const responses = paths[LIVENESS_PATH].get.responses;

      expect(Object.keys(responses)).not.toContain('503');
      expect(enumOf(responses['200'])).toEqual(['ok']);
    });

    it('should declare one body per readiness outcome', () => {
      const responses = paths[READINESS_PATH].get.responses;

      expect(enumOf(responses['200'])).toEqual(['ok']);
      expect(enumOf(responses['503'])).toEqual(['unavailable']);
    });
  });
});
