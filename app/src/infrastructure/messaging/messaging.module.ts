import { Global, Module } from '@nestjs/common';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

import { MessageHandlerRegistry } from './message-handler.registry';
import { createSnsClient, createSqsClient } from './messaging-clients';
import { OutboxRelayService } from './outbox-relay.service';
import { SqsConsumerService } from './sqs-consumer.service';

@Global()
@Module({
  providers: [
    { provide: SNSClient, useFactory: createSnsClient },
    { provide: SQSClient, useFactory: createSqsClient },
    MessageHandlerRegistry,
    OutboxRelayService,
    SqsConsumerService,
  ],
  exports: [SNSClient, SQSClient, MessageHandlerRegistry],
})
export class MessagingModule {}
