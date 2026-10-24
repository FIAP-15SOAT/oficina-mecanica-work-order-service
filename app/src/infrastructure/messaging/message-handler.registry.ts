import { Injectable } from '@nestjs/common';

import { MessageHandler } from '@application/messaging/message-envelope';
import { MessageType } from '@domain/messaging/message-catalog';

export type PayloadClass = new () => object;

export interface RegisteredHandler {
  handler: MessageHandler;
  payloadClass?: PayloadClass;
}

/** Modules register their handlers on onModuleInit; the consumer looks them up by type. */
@Injectable()
export class MessageHandlerRegistry {
  private readonly handlers = new Map<string, RegisteredHandler>();

  register<T extends MessageType>(
    type: T,
    handler: MessageHandler<T>,
    payloadClass?: PayloadClass,
  ): void {
    if (this.handlers.has(type)) {
      throw new Error(`a handler is already registered for ${type}`);
    }

    this.handlers.set(type, { handler: handler as MessageHandler, payloadClass });
  }

  find(type: string): RegisteredHandler | undefined {
    return this.handlers.get(type);
  }
}
