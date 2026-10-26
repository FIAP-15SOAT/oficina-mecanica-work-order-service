import { BillingMessagePayloads } from './billing.messages';
import { InventoryMessagePayloads } from './inventory.messages';
import { NotificationMessagePayloads } from './notification.messages';

export type MessagePayloads = InventoryMessagePayloads &
  BillingMessagePayloads &
  NotificationMessagePayloads;

export type MessageType = keyof MessagePayloads;

export type OutboxMessage = {
  [T in MessageType]: { type: T; workOrderId: string | null; payload: MessagePayloads[T] };
}[MessageType];
