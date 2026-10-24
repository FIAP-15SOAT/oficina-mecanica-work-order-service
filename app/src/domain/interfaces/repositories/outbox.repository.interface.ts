import { OutboxMessage } from '@domain/messaging/message-catalog';

export interface IOutboxRepository {
  add(message: OutboxMessage): Promise<void>;
}
