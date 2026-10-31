import { User } from '@domain/entities/user.entity';
import { PasswordGenerator } from '@domain/services/password-generator';

import { IHashService } from '@application/ports/output/services/hash.service.interface';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';

import {
  CreateUserDto,
  CreateUserOutputDto,
} from '@application/ports/input/user/dto/create-user.dto';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';

export class CreateUserUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly hashService: IHashService,
    private readonly emailSender: IEmailSenderService,
    private readonly logger: ILogger,
  ) {}

  async execute(createUserDto: CreateUserDto): Promise<CreateUserOutputDto> {
    const existing = await this.userRepository.findByEmail(
      createUserDto.email.trim().toLowerCase(),
    );

    if (existing) {
      throw new ResourceConflictException('E-mail já cadastrado no sistema');
    }

    const generatedPassword = PasswordGenerator.generate();
    const passwordHash = await this.hashService.hash(generatedPassword);

    const user = User.create({
      name: createUserDto.name,
      email: createUserDto.email,
      passwordHash,
      role: createUserDto.role,
      cpf: createUserDto.cpf,
    });

    const created = await this.userRepository.create(user);

    await this.sendInitialPasswordEmail(created, generatedPassword);

    return created.toPublicView();
  }

  private async sendInitialPasswordEmail(user: User, password: string): Promise<boolean> {
    try {
      await this.emailSender.send({
        toEmail: user.email.value,
        toName: user.name,
        subject: 'Sua conta na Oficina Mecânica foi criada',
        message: {
          text:
            `Olá ${user.name},\n\n` +
            `Sua conta de funcionário foi criada.\n` +
            `Senha inicial: ${password}\n\n` +
            `Recomendamos trocar a senha após o primeiro acesso.\n\n` +
            `Atenciosamente,\nEquipe da Oficina Mecânica`,
          html:
            `<p>Olá <strong>${user.name}</strong>,</p>` +
            `<p>Sua conta de funcionário foi criada.</p>` +
            `<p><strong>Senha inicial:</strong> ${password}</p>` +
            `<p>Recomendamos trocar a senha após o primeiro acesso.</p>` +
            `<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>`,
        },
      });

      return true;
    } catch {
      this.logger.event(BUSINESS_EVENTS.USER_INITIAL_PASSWORD_SEND_FAILED, {
        targetUserId: user.id,
      });

      return false;
    }
  }
}
