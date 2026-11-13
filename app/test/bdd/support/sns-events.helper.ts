import { randomUUID } from 'node:crypto';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

import { MessagePayloads, MessageType } from '@domain/messaging/message-catalog';

/** Publishes an event of a simulated participant on the topic, in the envelope the relay writes. */
export async function publishEvent<T extends MessageType>(
  sns: SNSClient,
  type: T,
  workOrderId: string,
  payload: MessagePayloads[T],
): Promise<void> {
  const messageId = randomUUID();

  await sns.send(
    new PublishCommand({
      TopicArn: process.env.MESSAGING_TOPIC_ARN,
      Message: JSON.stringify({
        messageId,
        type,
        occurredAt: new Date().toISOString(),
        workOrderId,
        payload,
      }),
      MessageGroupId: workOrderId,
      MessageDeduplicationId: messageId,
      MessageAttributes: { type: { DataType: 'String', StringValue: type } },
    }),
  );
}
