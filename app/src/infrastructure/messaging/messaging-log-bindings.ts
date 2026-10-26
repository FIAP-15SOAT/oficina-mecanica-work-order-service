import { LOGICAL_FIELDS } from '@infrastructure/logging/field-registry';

export interface MessagingLogContext {
  system: 'aws_sqs' | 'aws_sns';
  destination: string;
  messageId: string;
  operation: 'publish' | 'process';
  type?: string;
  workOrderId?: string | null;
}

/** request.id carries the message id, so every line of one message correlates like a request. */
export function messagingLogBindings(input: MessagingLogContext): Record<string, string> {
  const bindings: Record<string, string> = {
    'messaging.system': input.system,
    'messaging.destination.name': input.destination,
    'messaging.message.id': input.messageId,
    'messaging.operation': input.operation,
    'request.id': input.messageId,
  };

  if (input.type) {
    bindings['oficina.messaging.message.type'] = input.type;
  }

  if (input.workOrderId) {
    bindings[LOGICAL_FIELDS.workOrderId.key] = input.workOrderId;
  }

  return bindings;
}
