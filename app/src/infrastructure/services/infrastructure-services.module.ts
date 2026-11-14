import { Module } from '@nestjs/common';

import { MailerEmailSenderService } from './mailer-email-sender.service';

@Module({
  providers: [{ provide: 'IEmailSenderService', useClass: MailerEmailSenderService }],
  exports: ['IEmailSenderService'],
})
export class InfrastructureServicesModule {}
