import { ProcessLifecycleService } from '@infrastructure/logging/process-lifecycle.service';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import { createMockLogger } from '../../../helpers/logger-mock.factory';

describe('ProcessLifecycleService', () => {
  it('should scope the logger to itself', () => {
    const logger = createMockLogger();

    new ProcessLifecycleService(logger);

    expect(logger.forContext).toHaveBeenCalledWith('ProcessLifecycleService');
  });

  /**
   * Process shutdown is an event of its own, distinct from the database
   * disconnect. With the synchronous destination the guarantee is simple: the
   * record is written before the hook returns — no `flush()`, which only exists
   * for an asynchronous destination.
   */
  it('should emit the shutdown event carrying the signal', () => {
    const logger = createMockLogger();

    new ProcessLifecycleService(logger).onApplicationShutdown('SIGTERM');

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.APPLICATION_SHUTDOWN, {
      signal: 'SIGTERM',
    });
  });

  it('should emit the shutdown event even when no signal is given', () => {
    const logger = createMockLogger();

    new ProcessLifecycleService(logger).onApplicationShutdown();

    expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.APPLICATION_SHUTDOWN, {
      signal: undefined,
    });
  });
});
