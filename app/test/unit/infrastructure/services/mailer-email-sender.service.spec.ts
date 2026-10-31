import { Test, TestingModule } from '@nestjs/testing';
import { MailerService } from '@nestjs-modules/mailer';

import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { MailerEmailSenderService } from '@infrastructure/services/mailer-email-sender.service';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import { createMockLogger } from '../../../helpers/logger-mock.factory';

describe('MailerEmailSenderService', () => {
  let service: MailerEmailSenderService;
  let mailerService: jest.Mocked<MailerService>;
  let logger: jest.Mocked<ILogger>;

  beforeEach(async () => {
    logger = createMockLogger();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailerEmailSenderService,
        { provide: MailerService, useValue: { sendMail: jest.fn() } },
        { provide: 'ILogger', useValue: logger },
      ],
    }).compile();

    service = module.get<MailerEmailSenderService>(MailerEmailSenderService);
    mailerService = module.get(MailerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('send', () => {
    const input = {
      toEmail: 'maria.silva@example.com',
      toName: 'Maria Silva',
      subject: 'Orçamento aguardando aprovação',
      message: {
        text: 'Acesse o sistema autenticando com seu CPF e senha para aprovar ou rejeitar.',
        html: '<p>Acesse o sistema autenticando com seu CPF e senha para aprovar ou rejeitar.</p>',
      },
    };

    it('should call mailerService.sendMail with correct parameters', async () => {
      mailerService.sendMail.mockResolvedValueOnce({});

      await service.send(input);

      expect(mailerService.sendMail).toHaveBeenCalledWith({
        to: `${input.toName} <${input.toEmail}>`,
        subject: input.subject,
        text: input.message.text,
        html: input.message.html,
      });
    });

    it('should record the delivery with operation, destination, outcome and duration', async () => {
      mailerService.sendMail.mockResolvedValueOnce({});

      await service.send(input);

      expect(logger.event).toHaveBeenCalledTimes(1);

      const [definition, fields] = logger.event.mock.calls[0];

      expect(definition).toBe(TECHNICAL_EVENTS.EMAIL_SENT);
      expect(fields).toMatchObject({
        mailOperation: 'send',
        mailDestinationSystem: 'smtp',
        mailOutcome: 'sent',
      });
      expect(typeof (fields as { mailDurationMs: number }).mailDurationMs).toBe('number');
    });

    it('should throw ServiceIntegrationException when mailerService.sendMail fails', async () => {
      mailerService.sendMail.mockRejectedValue(new Error('SMTP Error'));

      await expect(service.send(input)).rejects.toThrow(ServiceIntegrationException);
    });

    it('should record the failure with the error category and the attached error', async () => {
      const error = new Error('SMTP Error');
      mailerService.sendMail.mockRejectedValue(error);

      await expect(service.send(input)).rejects.toThrow(ServiceIntegrationException);

      expect(logger.event).toHaveBeenCalledTimes(1);
      expect(logger.event.mock.calls[0][0]).toBe(TECHNICAL_EVENTS.EMAIL_SEND_FAILED);
      expect(logger.event.mock.calls[0][1]).toMatchObject({
        mailOutcome: 'failed',
        mailErrorCategory: 'transport',
      });
      expect(logger.event.mock.calls[0][2]).toBe(error);
    });

    it('should categorise a rejection that is not an error as unknown', async () => {
      mailerService.sendMail.mockRejectedValue('conexão recusada');

      await expect(service.send(input)).rejects.toThrow(ServiceIntegrationException);

      expect(logger.event.mock.calls[0][1]).toMatchObject({ mailErrorCategory: 'unknown' });
    });

    it('should declare the recipient under the field the registry masks', async () => {
      mailerService.sendMail.mockRejectedValue(new Error('SMTP Error'));

      await expect(service.send(input)).rejects.toThrow(ServiceIntegrationException);

      expect(logger.event.mock.calls[0][1]).toMatchObject({ mailRecipient: input.toEmail });
    });

    it('should never emit the message body, which carries capability-token links', async () => {
      mailerService.sendMail.mockRejectedValue(new Error('SMTP Error'));

      await expect(service.send(input)).rejects.toThrow(ServiceIntegrationException);

      const emitted = JSON.stringify(logger.event.mock.calls);

      expect(emitted).not.toContain('token=abc');
      expect(emitted).not.toContain(input.message.text);
      expect(emitted).not.toContain(input.message.html);
    });

    it('should not leak the recipient address through the thrown exception', async () => {
      mailerService.sendMail.mockRejectedValue(new Error('SMTP Error'));

      await expect(service.send(input)).rejects.toThrow(
        new ServiceIntegrationException('Não foi possível enviar o e-mail.'),
      );
    });
  });
});
