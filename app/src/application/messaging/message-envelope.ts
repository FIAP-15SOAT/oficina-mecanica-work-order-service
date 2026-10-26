import { MessagePayloads, MessageType } from '@domain/messaging/message-catalog';

export interface MessageEnvelope<T extends MessageType = MessageType> {
  messageId: string;
  type: T;
  occurredAt: string;
  workOrderId: string | null;
  payload: MessagePayloads[T];
}

export type MessageHandler<T extends MessageType = MessageType> = (
  envelope: MessageEnvelope<T>,
) => Promise<void>;
