import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { MessageEnvelope } from '@application/messaging/message-envelope';
import { waitFor } from './wait-for.helper';

// Deletes every message it receives; one more short poll after the expected count catches extras.
export async function receiveCommands(
  sqs: SQSClient,
  queueUrl: string,
  workOrderId: string,
  expectedCount: number,
): Promise<MessageEnvelope[]> {
  const commands: MessageEnvelope[] = [];

  const receive = async (): Promise<void> => {
    const { Messages = [] } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );

    for (const message of Messages) {
      const envelope = JSON.parse(message.Body as string) as MessageEnvelope;

      if (envelope.workOrderId === workOrderId) commands.push(envelope);

      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
      );
    }
  };

  await waitFor(async () => {
    await receive();
    return commands.length >= expectedCount;
  });

  await receive();

  return commands;
}
