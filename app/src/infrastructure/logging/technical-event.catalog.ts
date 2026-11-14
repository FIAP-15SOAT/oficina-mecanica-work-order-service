import { defineLogEvent } from '@application/logging/log-event';

export type HealthFailureCategory =
  | 'timeout'
  | 'connection'
  | 'pool'
  | 'authentication'
  | 'query'
  | 'unknown';

type EmptyFields = Record<never, never>;

export const TECHNICAL_EVENTS = {
  APPLICATION_STARTED: defineLogEvent<{ port: number }>({
    name: 'app.started',
    message: 'http server accepting connections',
    level: 'info',
  }),
  APPLICATION_SHUTDOWN: defineLogEvent<{ signal?: string }>({
    name: 'app.shutdown',
    message: 'application shutdown completed',
    level: 'info',
  }),
  APPLICATION_BOOTSTRAP_FAILED: defineLogEvent<EmptyFields>({
    name: 'app.bootstrap.failed',
    message: 'application failed to start',
    level: 'error',
  }),
  DATABASE_CONNECTED: defineLogEvent<EmptyFields>({
    name: 'db.connected',
    message: 'database connection pool initialized',
    level: 'info',
  }),
  DATABASE_CONNECTION_FAILED: defineLogEvent<EmptyFields>({
    name: 'db.connection.failed',
    message: 'database connection pool could not be initialized',
    level: 'error',
  }),
  DATABASE_DISCONNECTED: defineLogEvent<EmptyFields>({
    name: 'db.disconnected',
    message: 'database connection pool closed',
    level: 'info',
  }),
  HEALTH_DEGRADED: defineLogEvent<{
    dependencyName: string;
    healthFailureCategory: HealthFailureCategory;
  }>({
    name: 'health.degraded',
    message: 'dependency health check started failing',
    level: 'warn',
  }),
  HEALTH_RECOVERED: defineLogEvent<{
    dependencyName: string;
    healthDegradedDurationMs: number;
  }>({
    name: 'health.recovered',
    message: 'dependency health check recovered',
    level: 'info',
  }),
  HTTP_REQUEST_FAILED: defineLogEvent<EmptyFields>({
    name: 'http.request.failed',
    message: 'http request failed with a server error',
    level: 'error',
  }),
  MESSAGING_OUTBOX_PUBLISH_FAILED: defineLogEvent<EmptyFields>({
    name: 'messaging.outbox.publish_failed',
    message: 'outbox message could not be published',
    level: 'error',
  }),
  MESSAGING_MESSAGE_UNHANDLED: defineLogEvent<EmptyFields>({
    name: 'messaging.message.unhandled',
    message: 'message received without a registered handler',
    level: 'warn',
  }),
  MESSAGING_MESSAGE_FAILED: defineLogEvent<EmptyFields>({
    name: 'messaging.message.failed',
    message: 'message processing failed',
    level: 'error',
  }),
  MESSAGING_MESSAGE_DEAD_LETTERED: defineLogEvent<EmptyFields>({
    name: 'messaging.message.dead_lettered',
    message: 'message failed on its last delivery and goes to the dead-letter queue',
    level: 'error',
  }),
  CACHE_UNAVAILABLE: defineLogEvent<EmptyFields>({
    name: 'cache.unavailable',
    message: 'cache command failed, falling back to the database',
    level: 'warn',
  }),
  CACHE_INVALIDATION_FAILED: defineLogEvent<EmptyFields>({
    name: 'cache.invalidation_failed',
    message: 'cache keys could not be deleted after a write',
    level: 'error',
  }),
} as const;
