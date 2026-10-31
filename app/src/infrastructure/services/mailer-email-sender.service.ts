import { Inject, Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

import {
  IEmailSenderService,
  SendEmailInput,
} from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';

import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

const MAIL_OPERATION = 'send';
const MAIL_DESTINATION_SYSTEM = 'smtp';

@Injectable()
export class MailerEmailSenderService implements IEmailSenderService {
  private readonly logger: ILogger;

  constructor(
    private readonly mailerService: MailerService,
    @Inject('ILogger') logger: ILogger,
  ) {
    this.logger = logger.forContext(MailerEmailSenderService.name);
  }

  async send(input: SendEmailInput): Promise<void> {
    const { toEmail, toName, subject, message } = input;
    const startedAt = Date.now();

    try {
      await this.mailerService.sendMail({
        to: `${toName} <${toEmail}>`,
        subject: subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      this.logger.event(
        TECHNICAL_EVENTS.EMAIL_SEND_FAILED,
        {
          mailOperation: MAIL_OPERATION,
          mailDestinationSystem: MAIL_DESTINATION_SYSTEM,
          mailOutcome: 'failed',
          mailRecipient: toEmail,
          mailDurationMs: Date.now() - startedAt,
          mailErrorCategory: error instanceof Error ? 'transport' : 'unknown',
        },
        error,
      );

      throw new ServiceIntegrationException('Não foi possível enviar o e-mail.');
    }

    this.logger.event(TECHNICAL_EVENTS.EMAIL_SENT, {
      mailOperation: MAIL_OPERATION,
      mailDestinationSystem: MAIL_DESTINATION_SYSTEM,
      mailOutcome: 'sent',
      mailRecipient: toEmail,
      mailDurationMs: Date.now() - startedAt,
    });
  }
}
