import { Module } from '@nestjs/common';

import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { CreateUserUseCase } from '@application/use-cases/user/create-user.use-case';
import { DeleteUserUseCase } from '@application/use-cases/user/delete-user.use-case';
import { FindAllUsersUseCase } from '@application/use-cases/user/find-all-users.use-case';
import { FindUserByIdUseCase } from '@application/use-cases/user/find-user-by-id.use-case';
import { UpdateUserStatusUseCase } from '@application/use-cases/user/update-user-status.use-case';
import { UpdateUserUseCase } from '@application/use-cases/user/update-user.use-case';
import { IssuePasswordResetCodeUseCase } from '@application/use-cases/auth/issue-password-reset-code.use-case';

import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IPasswordResetCodeRepository } from '@domain/interfaces/repositories/password-reset-code.repository.interface';
import { IHashService } from '@application/ports/output/services/hash.service.interface';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';

import { UserController as UserCleanController } from '@interface-adapters/user/user.controller';
import { UserController } from './user.controller';

@Module({
  imports: [InfrastructureServicesModule],
  controllers: [UserController],
  providers: [
    {
      provide: UserCleanController,
      useFactory: (
        userRepository: IUserRepository,
        userCustomerRepository: IUserCustomerRepository,
        passwordResetCodeRepository: IPasswordResetCodeRepository,
        hashService: IHashService,
        emailSender: IEmailSenderService,
        logger: ILogger,
      ) =>
        new UserCleanController(
          new CreateUserUseCase(
            userRepository,
            hashService,
            emailSender,
            logger.forContext(CreateUserUseCase.name),
          ),
          new FindUserByIdUseCase(userRepository, userCustomerRepository),
          new FindAllUsersUseCase(userRepository),
          new UpdateUserUseCase(userRepository),
          new UpdateUserStatusUseCase(
            userRepository,
            logger.forContext(UpdateUserStatusUseCase.name),
          ),
          new DeleteUserUseCase(userRepository),
          new IssuePasswordResetCodeUseCase(
            userRepository,
            passwordResetCodeRepository,
            hashService,
            emailSender,
            logger.forContext(IssuePasswordResetCodeUseCase.name),
          ),
        ),
      inject: [
        'IUserRepository',
        'IUserCustomerRepository',
        'IPasswordResetCodeRepository',
        'IHashService',
        'IEmailSenderService',
        'ILogger',
      ],
    },
  ],
})
export class UserModule {}
