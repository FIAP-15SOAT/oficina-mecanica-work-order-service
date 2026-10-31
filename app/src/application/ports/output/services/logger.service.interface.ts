import { LogEventDefinition } from '@application/logging/log-event';
import { LogFields } from '@application/logging/log-field';

import { NoExtraFields } from './no-extra-fields';

export type { NoExtraFields };

export interface ILogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
  event<TFields extends LogFields, TGiven extends TFields>(
    definition: LogEventDefinition<TFields>,
    fields: NoExtraFields<TFields, TGiven>,
    error?: unknown,
  ): void;
  forContext(scope: string): ILogger;
}
