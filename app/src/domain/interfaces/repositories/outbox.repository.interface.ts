import { OutboxMessage } from '@domain/messaging/message-catalog';

export interface IOutboxRepository {
  // Ids follow INSERT order, not COMMIT order, and the relay publishes by id: update (with version)
  // or lock the message's work order row in the same transaction before adding it.
  add(message: OutboxMessage): Promise<void>;
}
