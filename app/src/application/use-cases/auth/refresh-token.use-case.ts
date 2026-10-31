import {
  ITokenService,
  TokenPair,
  TokenPayload,
} from '@application/ports/output/services/token.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import {
  RefreshTokenInputDto,
  RefreshTokenOutputDto,
} from '@application/ports/input/auth/dto/refresh-token.dto';

import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';

const INVALID_REFRESH_TOKEN_MESSAGE = 'Refresh token inválido ou expirado';

export class RefreshTokenUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly tokenService: ITokenService,
    private readonly logger: ILogger,
  ) {}

  async execute(input: RefreshTokenInputDto): Promise<RefreshTokenOutputDto> {
    let payload: TokenPayload;

    try {
      payload = this.tokenService.verifyRefreshToken(input.refreshToken);
    } catch {
      this.logger.event(BUSINESS_EVENTS.REFRESH_TOKEN_FAILED, { failureReason: 'invalid_token' });

      throw new UnauthorizedAccessException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const user = await this.userRepository.findById(payload.sub);

    if (!user) {
      this.logger.event(BUSINESS_EVENTS.REFRESH_TOKEN_FAILED, {
        failureReason: 'unknown_user',
        subjectId: payload.sub,
      });

      throw new UnauthorizedAccessException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (!user.isActive) {
      this.logger.event(BUSINESS_EVENTS.REFRESH_TOKEN_FAILED, {
        failureReason: 'inactive_user',
        subjectId: user.id,
        subjectName: user.name,
        subjectEmail: user.email.value,
      });

      throw new UnauthorizedAccessException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (!user.role) {
      this.logger.event(BUSINESS_EVENTS.REFRESH_TOKEN_FAILED, {
        failureReason: 'no_internal_role',
        subjectId: user.id,
        subjectName: user.name,
        subjectEmail: user.email.value,
      });

      throw new UnauthorizedAccessException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (
      typeof payload.iat !== 'number' ||
      payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      this.logger.event(BUSINESS_EVENTS.REFRESH_TOKEN_FAILED, {
        failureReason: 'password_changed',
        subjectId: user.id,
        subjectName: user.name,
        subjectEmail: user.email.value,
      });

      throw new UnauthorizedAccessException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const newTokenPair: TokenPair = this.tokenService.signTokenPair({
      sub: user.id,
      email: user.email.value,
      name: user.name,
      role: user.role,
    });

    return {
      accessToken: newTokenPair.accessToken,
      refreshToken: newTokenPair.refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email.value,
        role: user.role,
      },
    };
  }
}
