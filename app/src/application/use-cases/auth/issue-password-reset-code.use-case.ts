import { PasswordResetCode } from '@domain/entities/password-reset-code.entity';
import { User } from '@domain/entities/user.entity';
import { ResetCodeGenerator } from '@domain/services/reset-code-generator';

import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IPasswordResetCodeRepository } from '@domain/interfaces/repositories/password-reset-code.repository.interface';
import { IHashService } from '@application/ports/output/services/hash.service.interface';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';

import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IIssuePasswordResetCodeUseCase } from '@application/ports/input/auth/issue-password-reset-code.use-case.interface';

export class IssuePasswordResetCodeUseCase implements IIssuePasswordResetCodeUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly passwordResetCodeRepository: IPasswordResetCodeRepository,
    private readonly hashService: IHashService,
    private readonly emailSender: IEmailSenderService,
    private readonly logger: ILogger,
  ) {}

  async execute(userId: string, actingUserId: string): Promise<void> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new ResourceNotFoundException('Usuário', userId);
    }

    const plainCode = ResetCodeGenerator.generate();
    const codeHash = await this.hashService.hash(plainCode);

    const code = PasswordResetCode.create(user.id, codeHash);
    await this.passwordResetCodeRepository.upsert(code);

    await this.sendResetCodeEmail(user, plainCode);

    this.logger.event(BUSINESS_EVENTS.USER_PASSWORD_RESET_ISSUED, {
      subjectId: actingUserId,
      targetUserId: user.id,
    });
  }

  private async sendResetCodeEmail(user: User, plainCode: string): Promise<void> {
    await this.emailSender.send({
      toEmail: user.email.value,
      toName: user.name,
      subject: 'Código para redefinição de senha',
      message: {
        text:
          `Olá ${user.name},\n\n` +
          `Use o código abaixo para redefinir sua senha. Ele expira em 10 minutos.\n\n` +
          `Código: ${plainCode}\n\n` +
          `Se você não solicitou este código, ignore este e-mail.`,
        html:
          `<p>Olá <strong>${user.name}</strong>,</p>` +
          `<p>Use o código abaixo para redefinir sua senha. Ele expira em 10 minutos.</p>` +
          `<p style="font-size: 24px; font-weight: bold;">${plainCode}</p>` +
          `<p>Se você não solicitou este código, ignore este e-mail.</p>`,
      },
    });
  }
}
