import { IHashService } from '@application/ports/output/hash.service.interface';
import { ITokenService } from '@application/ports/output/token.service.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';

import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import {
  AuthenticateUserInputDto,
  AuthenticateUserOutputDto,
} from '@application/ports/input/auth/dto/authenticate-user.dto';

import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';

const INVALID_CREDENTIALS_MESSAGE = 'Credenciais inválidas';

export class AuthenticateUserUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly hashService: IHashService,
    private readonly tokenService: ITokenService,
    private readonly logger: ILogger,
  ) {}

  async execute(input: AuthenticateUserInputDto): Promise<AuthenticateUserOutputDto> {
    const user = await this.userRepository.findByEmail(input.email);

    if (!user) {
      this.logger.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, { failureReason: 'unknown_user' });

      throw new UnauthorizedAccessException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (!user.isActive) {
      this.logger.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, {
        failureReason: 'inactive_user',
        subjectId: user.id,
        subjectName: user.name,
        subjectEmail: user.email.value,
      });

      throw new UnauthorizedAccessException(INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await this.hashService.compare(input.password, user.passwordHash);

    if (!passwordMatches) {
      this.logger.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, {
        failureReason: 'wrong_password',
        subjectId: user.id,
        subjectName: user.name,
        subjectEmail: user.email.value,
      });

      throw new UnauthorizedAccessException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (!user.role) {
      this.logger.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, {
        failureReason: 'no_internal_role',
        subjectId: user.id,
        subjectName: user.name,
        subjectEmail: user.email.value,
      });

      throw new UnauthorizedAccessException(INVALID_CREDENTIALS_MESSAGE);
    }

    const payload = {
      sub: user.id,
      email: user.email.value,
      name: user.name,
      role: user.role,
    };

    const { accessToken, refreshToken } = this.tokenService.signTokenPair(payload);

    this.logger.event(BUSINESS_EVENTS.AUTHENTICATION_SUCCEEDED, {
      subjectId: user.id,
      subjectName: user.name,
      subjectEmail: user.email.value,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email.value,
        role: user.role,
      },
    };
  }
}
