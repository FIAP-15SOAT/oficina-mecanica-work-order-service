import { NestExpressApplication } from '@nestjs/platform-express';

import {
  configureApp,
  DEFAULT_ALLOWED_ORIGIN,
  DEFAULT_PORT,
  resolvePort,
} from '@infrastructure/config/app-bootstrap';
import { setupSwagger } from '@infrastructure/config/swagger.config';
import { GLOBAL_PREFIX, INTERNAL_PREFIX } from '@infrastructure/http/http.constants';
import { rejectOutsideGlobalPrefix } from '@infrastructure/http/outside-prefix.middleware';
import { TRUST_PROXY_REJECTED_WARNING } from '@infrastructure/logging/logger.config';

jest.mock('@infrastructure/config/swagger.config', () => ({ setupSwagger: jest.fn() }));

interface FakeApp {
  app: NestExpressApplication;
  calls: string[];
  enableCors: jest.Mock;
  set: jest.Mock;
}

function createFakeApp(): FakeApp {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): unknown => {
      calls.push(name);

      return args;
    };

  const set = jest.fn(record('set'));
  const enableCors = jest.fn(record('enableCors'));

  const app = {
    setGlobalPrefix: jest.fn(record('setGlobalPrefix')),
    use: jest.fn(record('use')),
    set,
    useGlobalPipes: jest.fn(record('useGlobalPipes')),
    useGlobalInterceptors: jest.fn(record('useGlobalInterceptors')),
    enableCors,
  } as unknown as NestExpressApplication;

  return { app, calls, enableCors, set };
}

describe('configureApp', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.TRUSTED_PROXY_CIDRS;
    delete process.env.LOG_LEVEL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should apply the global prefix, leaving the internal routes out of it', () => {
    const { app } = createFakeApp();

    configureApp(app);

    expect(app.setGlobalPrefix).toHaveBeenCalledWith(GLOBAL_PREFIX, {
      exclude: [`${INTERNAL_PREFIX}/*path`],
    });
  });

  /**
   * A ordem é o contrato desta função, não um detalhe. `use()` e `enableCors()`
   * registram middleware do Express na hora da chamada, e o Swagger registra
   * rotas direto no adaptador — a cadeia efetiva (`helmet → cors → swagger →
   * body parser → middleware do LoggerModule → router`) é o que decide a
   * fronteira de cobertura declarada do access log. Trocar duas linhas aqui
   * regride a fronteira em silêncio.
   */
  it('should register the express middleware in the declared order', () => {
    const { app, calls } = createFakeApp();

    configureApp(app, { withSwagger: true });

    expect(calls).toEqual([
      'setGlobalPrefix',
      'use',
      'use',
      'set',
      'useGlobalPipes',
      'useGlobalInterceptors',
      'enableCors',
    ]);
    expect(setupSwagger).toHaveBeenCalledWith(app);
    expect(app.use).toHaveBeenNthCalledWith(2, rejectOutsideGlobalPrefix);
  });

  it('should not register swagger unless it is asked for', () => {
    const { app } = createFakeApp();

    configureApp(app);

    expect(setupSwagger).not.toHaveBeenCalled();
  });

  it('should expose the correlation header so a browser client can read it', () => {
    const { app, enableCors } = createFakeApp();

    configureApp(app);

    expect(enableCors.mock.calls[0][0]).toMatchObject({
      exposedHeaders: ['x-request-id'],
      credentials: true,
    });
  });

  it('should fall back to the local origin when none is configured', () => {
    const { app, enableCors } = createFakeApp();

    configureApp(app);

    expect(enableCors.mock.calls[0][0]).toMatchObject({ origin: [DEFAULT_ALLOWED_ORIGIN] });
  });

  it('should read the configured origins from the environment', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.test,https://b.test';

    const { app, enableCors } = createFakeApp();

    configureApp(app);

    expect(enableCors.mock.calls[0][0]).toMatchObject({
      origin: ['https://a.test', 'https://b.test'],
    });
  });

  it('should let the caller override the origins', () => {
    const { app, enableCors } = createFakeApp();

    configureApp(app, { allowedOrigins: true });

    expect(enableCors.mock.calls[0][0]).toMatchObject({ origin: true });
  });

  it('should trust no proxy when none is configured', () => {
    const { app, set } = createFakeApp();

    configureApp(app);

    expect(set).toHaveBeenCalledWith('trust proxy', false);
  });

  it('should hand the configured proxy list to express', () => {
    process.env.TRUSTED_PROXY_CIDRS = '10.0.0.0/8, loopback';

    const { app, set } = createFakeApp();

    configureApp(app);

    expect(set).toHaveBeenCalledWith('trust proxy', ['10.0.0.0/8', 'loopback']);
  });

  it('should surface the startup warnings instead of failing the boot', () => {
    process.env.LOG_LEVEL = 'ruidoso';

    const { app } = createFakeApp();

    expect(configureApp(app)).toEqual(['LOG_LEVEL desconhecido, aplicando o padrão "info"']);
  });

  it('should fall back to trusting nothing when express rejects the list', () => {
    process.env.TRUSTED_PROXY_CIDRS = 'não-é-um-cidr';

    const { app, set } = createFakeApp();

    set.mockImplementationOnce(() => {
      throw new TypeError('invalid IP');
    });

    expect(configureApp(app)).toEqual([TRUST_PROXY_REJECTED_WARNING]);
    expect(set).toHaveBeenLastCalledWith('trust proxy', false);
  });
});

/**
 * `app.listen()` roda o `init()` antes de abrir o socket, então uma porta
 * inválida só falha depois de o Prisma ter conectado. Resolver antes é o que
 * mantém o caminho fatal sem handle aberto.
 */
describe('resolvePort', () => {
  it.each([undefined, '', '   '])('should fall back to the default port for %p', (value) => {
    expect(resolvePort(value)).toBe(DEFAULT_PORT);
  });

  it.each([
    ['3000', 3000],
    [' 8080 ', 8080],
    ['65535', 65535],
    ['1', 1],
  ])('should accept %s', (value, expected) => {
    expect(resolvePort(value)).toBe(expected);
  });

  it.each(['abc', '70000', '0', '-1', '3000.5', 'NaN', 'Infinity'])(
    'should reject %s instead of listening on the wrong port',
    (value) => {
      expect(() => resolvePort(value)).toThrow(`PORT inválido: "${value}"`);
    },
  );
});
