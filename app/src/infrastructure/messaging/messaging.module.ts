import { Global, Module } from '@nestjs/common';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

import { MessageHandlerRegistry } from './message-handler.registry';
import { OutboxRelayService } from './outbox-relay.service';
import { SqsConsumerService } from './sqs-consumer.service';

// Region, credentials and endpoint come from the environment (AWS_REGION, AWS_ENDPOINT_URL).
// LocalStack queue URLs point at *.localhost.localstack.cloud (loopback inside a container),
// so the SQS client must keep the configured endpoint instead of the queue URL host.
@Global()
@Module({
  providers: [
    { provide: SNSClient, useFactory: () => new SNSClient({}) },
    { provide: SQSClient, useFactory: () => new SQSClient({ useQueueUrlAsEndpoint: false }) },
    MessageHandlerRegistry,
    OutboxRelayService,
    SqsConsumerService,
  ],
  exports: [SNSClient, SQSClient, MessageHandlerRegistry],
})
export class MessagingModule {}
