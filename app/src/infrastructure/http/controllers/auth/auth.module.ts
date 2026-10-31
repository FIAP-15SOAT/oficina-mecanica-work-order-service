import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { AuthenticateUserUseCase } from '@application/use-cases/auth/authenticate-user.use-case';
import { RefreshTokenUseCase } from '@application/use-cases/auth/refresh-token.use-case';
import { ConfirmPasswordResetUseCase } from '@application/use-cases/auth/confirm-password-reset.use-case';
import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { JwtStrategy } from '@infrastructure/http/strategies/jwt.strategy';
import { CustomerJwtStrategy } from '@infrastructure/http/strategies/customer-jwt.strategy';

import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IHashService } from '@application/ports/output/services/hash.service.interface';
import { ITokenService } from '@application/ports/output/services/token.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';

import { AuthController as AuthCleanController } from '@interface-adapters/auth/auth.controller';
import { AuthController } from './auth.controller';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), InfrastructureServicesModule],
  controllers: [AuthController],
  providers: [
    {
      provide: AuthCleanController,
      useFactory: (
        userRepository: IUserRepository,
        unitOfWork: IUnitOfWork,
        hashService: IHashService,
        tokenService: ITokenService,
        logger: ILogger,
      ) =>
        new AuthCleanController(
          new AuthenticateUserUseCase(
            userRepository,
            hashService,
            tokenService,
            logger.forContext(AuthenticateUserUseCase.name),
          ),
          new RefreshTokenUseCase(
            userRepository,
            tokenService,
            logger.forContext(RefreshTokenUseCase.name),
          ),
          new ConfirmPasswordResetUseCase(
            unitOfWork,
            hashService,
            logger.forContext(ConfirmPasswordResetUseCase.name),
          ),
        ),
      inject: ['IUserRepository', 'IUnitOfWork', 'IHashService', 'ITokenService', 'ILogger'],
    },
    JwtStrategy,
    CustomerJwtStrategy,
  ],
  exports: [JwtStrategy, CustomerJwtStrategy],
})
export class AuthModule {}
