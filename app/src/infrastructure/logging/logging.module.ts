import { hostname } from 'node:os';
import { Global, Module, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule, PinoLogger } from 'nestjs-pino';
import type { Params } from 'nestjs-pino';
import { DestinationStream } from 'pino';

import { RequestContextInterceptor } from '@infrastructure/http/interceptors/request-context.interceptor';

import { createDefaultDestination } from './logging-destination';
import { runSafely } from './logging-diagnostics';
import { REDACTED, sanitizeText } from './redaction/text-sanitizer';
import {
  buildAccessLogAttributes,
  DURATION_ATTRIBUTE,
  generateRequestId,
  REQUEST_ID_ATTRIBUTE,
  resolveAccessLogLevel,
} from './access-log.builder';
import { normalizeLogRecord } from './log-record-normalizer';
import { LogLevel, resolveLoggerConfig } from './logger.config';
import { PinoLoggerAdapter } from './pino-logger.adapter';
import { ProcessLifecycleService } from './process-lifecycle.service';
import { buildTraceCorrelation } from './trace-correlation';

export const LOGGER_DESTINATION = 'LOGGER_DESTINATION';
export const LOGGER_LEVEL = 'LOGGER_LEVEL';

export const ACCESS_LOG_MESSAGE = 'http request';

function buildAccessLogMessage(): string {
  return ACCESS_LOG_MESSAGE;
}

function sanitizeMessage(message: unknown): unknown {
  if (typeof message !== 'string') {
    return message;
  }

  return runSafely('serialization', () => sanitizeText(message), REDACTED);
}

export function buildLoggerParams(destination: DestinationStream, level: LogLevel): Params {
  const { resource } = resolveLoggerConfig();

  return {
    renameContext: 'otel.scope.name',
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    pinoHttp: [
      {
        level,
        base: { ...resource, 'host.name': hostname(), 'process.pid': process.pid },
        messageKey: 'message',
        timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
        // pino applies the `mixin` **before** `formatters.log`, so the three
        // fields go through `normalizeLogRecord` like any other key — and that
        // is why they must be declared in the dictionary, or they would vanish
        // silently.
        mixin: buildTraceCorrelation,
        formatters: {
          level: (label: string) => ({ level: label }),
          log: normalizeLogRecord,
        },
        redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
        serializers: {
          req: () => undefined,
          res: () => undefined,
          err: () => undefined,
          message: sanitizeMessage,
        },
        quietReqLogger: true,
        quietResLogger: true,
        customAttributeKeys: {
          reqId: REQUEST_ID_ATTRIBUTE,
          responseTime: DURATION_ATTRIBUTE,
        },
        genReqId: generateRequestId,
        customLogLevel: resolveAccessLogLevel,
        // Both hooks must exist because pino-http routes 4xx through the
        // success hook, not the error one.
        customSuccessMessage: buildAccessLogMessage,
        customErrorMessage: buildAccessLogMessage,
        customSuccessObject: (request, response, baseObject: Record<string, unknown>) =>
          buildAccessLogAttributes(request, response, baseObject),
        customErrorObject: (request, response, error: Error, baseObject: Record<string, unknown>) =>
          buildAccessLogAttributes(request, response, baseObject, error),
      },
      destination,
    ],
  };
}

@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      providers: [
        { provide: LOGGER_DESTINATION, useFactory: createDefaultDestination },
        { provide: LOGGER_LEVEL, useFactory: () => resolveLoggerConfig().level },
      ],
      inject: [LOGGER_DESTINATION, LOGGER_LEVEL],
      useFactory: (destination: DestinationStream, level: LogLevel) =>
        buildLoggerParams(destination, level),
    }),
  ],
  providers: [
    {
      provide: PinoLoggerAdapter,
      useFactory: (pinoLogger: PinoLogger) => new PinoLoggerAdapter(pinoLogger),
      inject: [PinoLogger],
    },
    { provide: 'ILogger', useExisting: PinoLoggerAdapter },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    ProcessLifecycleService,
  ],
  exports: [LoggerModule, PinoLoggerAdapter, 'ILogger'],
})
export class LoggingModule {}
