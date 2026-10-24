import { Global, Module } from '@nestjs/common';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

import { MessageHandlerRegistry } from './message-handler.registry';
import { OutboxRelayService } from './outbox-relay.service';
import { SqsConsumerService } from './sqs-consumer.service';

// Region, credentials and endpoint come from the environment (AWS_REGION, AWS_ENDPOINT_URL).
@Global()
@Module({
  providers: [
    { provide: SNSClient, useFactory: () => new SNSClient({}) },
    { provide: SQSClient, useFactory: () => new SQSClient({}) },
    MessageHandlerRegistry,
    OutboxRelayService,
    SqsConsumerService,
  ],
  exports: [SNSClient, SQSClient, MessageHandlerRegistry],
})
export class MessagingModule {}
