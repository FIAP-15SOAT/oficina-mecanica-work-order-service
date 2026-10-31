import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';

import { ILogger } from '@application/ports/output/services/logger.service.interface';

import { TECHNICAL_EVENTS } from './technical-event.catalog';

@Injectable()
export class ProcessLifecycleService implements OnApplicationShutdown {
  private readonly logger: ILogger;

  constructor(@Inject('ILogger') logger: ILogger) {
    this.logger = logger.forContext(ProcessLifecycleService.name);
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.event(TECHNICAL_EVENTS.APPLICATION_SHUTDOWN, { signal });
  }
}
