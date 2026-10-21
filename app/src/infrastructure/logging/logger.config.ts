import { randomUUID } from 'node:crypto';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';
export const DEFAULT_SERVICE_NAME = 'oficina-mecanica-work-order-service';
export const DEFAULT_SERVICE_NAMESPACE = 'oficina-mecanica';
export const DEFAULT_SERVICE_VERSION = 'dev';
export const DEFAULT_DEPLOYMENT_ENVIRONMENT = 'development';

export const TRUST_PROXY_REJECTED_WARNING =
  'TRUSTED_PROXY_CIDRS inválido, nenhum proxy será considerado confiável';

export interface ResourceAttributes {
  'service.name': string;
  'service.namespace': string;
  'service.version': string;
  'service.instance.id': string;
  'deployment.environment.name': string;
}

export interface LoggerConfig {
  level: LogLevel;
  resource: ResourceAttributes;
  trustedProxies: string[] | false;
  warnings: string[];
}

export interface TrustProxyTarget {
  set(setting: string, value: unknown): unknown;
}

const SERVICE_INSTANCE_ID = randomUUID();

export function resolveLoggerConfig(env: NodeJS.ProcessEnv = process.env): LoggerConfig {
  const warnings: string[] = [];

  return {
    level: resolveLevel(env.LOG_LEVEL, warnings),
    resource: {
      'service.name': withDefault(env.OTEL_SERVICE_NAME, DEFAULT_SERVICE_NAME),
      'service.namespace': withDefault(env.OTEL_SERVICE_NAMESPACE, DEFAULT_SERVICE_NAMESPACE),
      'service.version': withDefault(env.SERVICE_VERSION, DEFAULT_SERVICE_VERSION),
      'service.instance.id': SERVICE_INSTANCE_ID,
      'deployment.environment.name': withDefault(env.NODE_ENV, DEFAULT_DEPLOYMENT_ENVIRONMENT),
    },
    trustedProxies: resolveTrustedProxies(env.TRUSTED_PROXY_CIDRS),
    warnings,
  };
}

export function applyTrustProxy(
  target: TrustProxyTarget,
  trustedProxies: string[] | false,
): string[] {
  try {
    target.set('trust proxy', trustedProxies);

    return [];
  } catch {
    target.set('trust proxy', false);

    return [TRUST_PROXY_REJECTED_WARNING];
  }
}

function withDefault(value: string | undefined, defaultValue: string): string {
  const trimmed = value?.trim();

  return trimmed ? trimmed : defaultValue;
}

function resolveLevel(value: string | undefined, warnings: string[]): LogLevel {
  const candidate = value?.trim().toLowerCase();

  if (!candidate) {
    return DEFAULT_LOG_LEVEL;
  }

  if ((LOG_LEVELS as readonly string[]).includes(candidate)) {
    return candidate as LogLevel;
  }

  warnings.push(`LOG_LEVEL desconhecido, aplicando o padrão "${DEFAULT_LOG_LEVEL}"`);

  return DEFAULT_LOG_LEVEL;
}

function resolveTrustedProxies(value: string | undefined): string[] | false {
  const entries =
    value
      ?.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0) ?? [];

  return entries.length > 0 ? entries : false;
}
