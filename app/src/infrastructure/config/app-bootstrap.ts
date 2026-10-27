import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { GLOBAL_PREFIX, INTERNAL_PREFIX } from '@infrastructure/http/http.constants';
import { rejectOutsideGlobalPrefix } from '@infrastructure/http/outside-prefix.middleware';
import { DateSerializerInterceptor } from '@infrastructure/http/interceptors/date-serializer.interceptor';
import { SanitizeStringsPipe } from '@infrastructure/http/pipes/sanitize-strings.pipe';
import { REQUEST_ID_HEADER } from '@infrastructure/logging/access-log.builder';
import { applyTrustProxy, resolveLoggerConfig } from '@infrastructure/logging/logger.config';

import { setupSwagger } from './swagger.config';

export const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:3000';

export const DEFAULT_PORT = 3000;

const MAX_PORT = 65535;

/**
 * Resolves the port **before** Nest is built, because `app.listen()` runs
 * `init()` first: with an invalid port the failure only shows up after Prisma
 * has connected, and the process keeps an open handle while serving no one.
 *
 * Blank falls back to the default instead of becoming `0`: `Number('')` is `0`,
 * and Node treats `0` as "pick a free port" — the application would listen on
 * a port nobody knows.
 */
export function resolvePort(value: string | undefined): number {
  const raw = value?.trim();

  if (!raw) {
    return DEFAULT_PORT;
  }

  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`PORT inválido: "${value}"`);
  }

  return port;
}

export interface ConfigureAppOptions {
  allowedOrigins?: string[] | boolean;
  withSwagger?: boolean;
}

export function configureApp(
  app: NestExpressApplication,
  options: ConfigureAppOptions = {},
): string[] {
  const { trustedProxies, warnings } = resolveLoggerConfig();

  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: [`${INTERNAL_PREFIX}/*path`] });
  app.use(helmet());
  app.use(rejectOutsideGlobalPrefix);

  const proxyWarnings = applyTrustProxy(app, trustedProxies);

  app.useGlobalPipes(
    new SanitizeStringsPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new DateSerializerInterceptor());

  app.enableCors({
    origin: options.allowedOrigins ?? resolveAllowedOrigins(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  if (options.withSwagger) {
    setupSwagger(app);
  }

  return [...warnings, ...proxyWarnings];
}

function resolveAllowedOrigins(): string[] {
  return process.env.ALLOWED_ORIGINS?.split(',') ?? [DEFAULT_ALLOWED_ORIGIN];
}
