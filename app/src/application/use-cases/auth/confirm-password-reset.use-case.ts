import { User } from '@domain/entities/user.entity';

import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IHashService } from '@application/ports/output/services/hash.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';

import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { ConfirmPasswordResetDto } from '@application/ports/input/auth/dto/confirm-password-reset.dto';
import { IConfirmPasswordResetUseCase } from '@application/ports/input/auth/confirm-password-reset.use-case.interface';
import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';

type ConfirmOutcome = { rejected: false; userId: string } | { rejected: true; reason: string };

export class ConfirmPasswordResetUseCase implements IConfirmPasswordResetUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly hashService: IHashService,
    private readonly logger: ILogger,
  ) {}

  async execute(dto: ConfirmPasswordResetDto): Promise<void> {
    const outcome = await this.unitOfWork.executeTransaction((repos) =>
      this.attemptConfirmation(repos, dto),
    );

    if (outcome.rejected) {
      this.logger.event(BUSINESS_EVENTS.USER_PASSWORD_RESET_REJECTED, {
        resetOutcome: outcome.reason,
      });

      throw new UnauthorizedAccessException('Código de redefinição inválido ou expirado');
    }

    this.logger.event(BUSINESS_EVENTS.USER_PASSWORD_RESET_COMPLETED, {
      targetUserId: outcome.userId,
      resetOutcome: 'confirmed',
    });
  }

  /**
   * Every read and write runs in a single transaction: the attempt increment
   * must persist even when the result is a rejection, and the password change +
   * code consumption must be atomic (never one without the other). That is why
   * this method never throws — it returns the verdict, and `execute()` decides
   * whether to throw, after the transaction has committed.
   */
  private async attemptConfirmation(
    repos: IRepositories,
    dto: ConfirmPasswordResetDto,
  ): Promise<ConfirmOutcome> {
    const user = await repos.user.findByEmail(dto.email);

    if (!user) {
      return { rejected: true, reason: 'unknown_user' };
    }

    const validation = await this.validateCode(repos, user.id, dto.code);

    if (!validation.matches) {
      if (validation.reason === 'wrong_code') {
        await repos.passwordResetCode.incrementAttempts(user.id);
      }
      return { rejected: true, reason: validation.reason };
    }

    User.validatePasswordStrength(dto.newPassword);

    const newHash = await this.hashService.hash(dto.newPassword);
    user.changePassword(newHash);

    await Promise.all([repos.user.update(user), repos.passwordResetCode.delete(user.id)]);

    return { rejected: false, userId: user.id };
  }

  /** Only validates — never writes to the database. The caller decides the attempt increment. */
  private async validateCode(
    repos: IRepositories,
    userId: string,
    submittedCode: string,
  ): Promise<{ matches: true } | { matches: false; reason: string }> {
    const code = await repos.passwordResetCode.findByUserId(userId);

    if (!code) {
      return { matches: false, reason: 'no_code_issued' };
    }

    if (code.isExpired()) {
      return { matches: false, reason: 'expired' };
    }

    if (code.isExhausted()) {
      return { matches: false, reason: 'exhausted' };
    }

    const matches = await this.hashService.compare(submittedCode, code.codeHash);

    return matches ? { matches: true } : { matches: false, reason: 'wrong_code' };
  }
}
