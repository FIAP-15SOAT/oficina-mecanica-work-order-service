import { Global, Module } from '@nestjs/common';
import { SNSClient } from '@aws-sdk/client-sns';

import { OutboxRelayService } from './outbox-relay.service';

// Region, credentials and endpoint come from the environment (AWS_REGION, AWS_ENDPOINT_URL).
@Global()
@Module({
  providers: [{ provide: SNSClient, useFactory: () => new SNSClient({}) }, OutboxRelayService],
  exports: [SNSClient],
})
export class MessagingModule {}
