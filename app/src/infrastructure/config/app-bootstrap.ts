import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { GLOBAL_PREFIX } from '@infrastructure/http/http.constants';
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
 * Resolve a porta **antes** de o Nest ser construído, porque `app.listen()` roda
 * o `init()` primeiro: com a porta inválida a falha só aparece depois de o
 * Prisma ter conectado, e o processo fica com handle aberto sem servir ninguém.
 *
 * Vazio cai no padrão em vez de virar `0`: `Number('')` é `0`, e o Node trata
 * `0` como "escolha uma porta livre" — a aplicação subiria numa porta que
 * ninguém sabe qual é.
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

  app.setGlobalPrefix(GLOBAL_PREFIX);
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
