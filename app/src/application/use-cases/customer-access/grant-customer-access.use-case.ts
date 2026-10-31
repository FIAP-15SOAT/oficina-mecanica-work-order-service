import { User } from '@domain/entities/user.entity';
import { UserCustomer } from '@domain/entities/user-customer.entity';
import { Customer } from '@domain/entities/customer.entity';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';

import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IHashService } from '@application/ports/output/services/hash.service.interface';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { PasswordGenerator } from '@domain/services/password-generator';

import {
  GrantCustomerAccessDto,
  GrantCustomerAccessOutputDto,
} from '@application/ports/input/customer-access/dto/grant-customer-access.dto';
import { LinkedCustomerOutputDto } from '@application/ports/input/customer-access/dto/list-user-customers.dto';

import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { IGrantCustomerAccessUseCase } from '@application/ports/input/customer-access/grant-customer-access.use-case.interface';

interface PersonData {
  name: string;
  email: string;
  cpf: string;
}

interface PendingPassword {
  toEmail: string;
  toName: string;
  password: string;
}

interface GrantResult {
  user: User;
  pendingPassword: PendingPassword | null;
}

interface PendingGrant {
  finish(actingUserId: string): Promise<GrantCustomerAccessOutputDto>;
}

export class GrantCustomerAccessUseCase implements IGrantCustomerAccessUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly hashService: IHashService,
    private readonly emailSender: IEmailSenderService,
    private readonly logger: ILogger,
  ) {}

  /**
   * `repos` is optional so this use case can run as a single, self-contained call either way:
   * on its own (opens and commits its own transaction before sending the e-mail and auditing),
   * or as a step inside a caller's transaction (e.g. `CreateCustomerUseCase` granting access in
   * the same transaction as the `Customer` insert — passing its own `repos` through). Callers
   * never need to know about the internal write/finish split; they only ever call `execute()`.
   */
  async execute(
    customerId: string,
    actingUserId: string,
    input?: GrantCustomerAccessDto,
    repos?: IRepositories,
  ): Promise<GrantCustomerAccessOutputDto> {
    const pending = repos
      ? await this.grantAccess(repos, customerId, input)
      : await this.unitOfWork.executeTransaction((txRepos) =>
          this.grantAccess(txRepos, customerId, input),
        );

    return pending.finish(actingUserId);
  }

  private async grantAccess(
    repos: IRepositories,
    customerId: string,
    input?: GrantCustomerAccessDto,
  ): Promise<PendingGrant> {
    const customer = await repos.customer.findById(customerId);

    if (!customer) {
      throw new ResourceNotFoundException('Cliente', customerId);
    }

    if (!customer.isActive) {
      throw new BusinessRuleViolationException('Cliente inativo não pode receber novos acessos');
    }

    const person = this.resolvePersonData(customer, input);
    const { user, pendingPassword } = await this.resolveUser(repos, customerId, person);

    const customerSummary: LinkedCustomerOutputDto = {
      id: customer.id,
      name: customer.name,
      type: customer.type,
      isActive: customer.isActive,
    };

    return {
      finish: (actingUserId: string) =>
        this.sendInitialPasswordAndAudit(
          user,
          customerSummary,
          pendingPassword,
          customerId,
          actingUserId,
        ),
    };
  }

  /**
   * A matching CPF is the same natural person (User.cpf is globally @unique;
   * for INDIVIDUAL it comes from Customer.document, already unique and
   * validated) — reuse the User and only create the link. A matching e-mail
   * from ANOTHER person is the original bug (an e-mail is not an identity: it
   * changes, repeats and is typed by hand in the customer record) — it stays
   * a real conflict and is never reused.
   */
  private async resolveUser(
    repos: IRepositories,
    customerId: string,
    person: PersonData,
  ): Promise<GrantResult> {
    const [userByCpf, userByEmail] = await Promise.all([
      repos.user.findByCpf(person.cpf),
      repos.user.findByEmail(person.email),
    ]);

    if (userByEmail && userByEmail.id !== userByCpf?.id) {
      throw new ResourceConflictException(
        'O e-mail informado já pertence a outro usuário. Verifique o cadastro do cliente.',
      );
    }

    if (userByCpf) {
      await repos.userCustomer.create(UserCustomer.create({ userId: userByCpf.id, customerId }));

      return { user: userByCpf, pendingPassword: null };
    }

    const generatedPassword = PasswordGenerator.generate();
    const passwordHash = await this.hashService.hash(generatedPassword);

    const newUser = User.create({
      name: person.name,
      email: person.email,
      passwordHash,
      role: null,
      cpf: person.cpf,
    });

    const user = await repos.user.create(newUser);

    await repos.userCustomer.create(UserCustomer.create({ userId: user.id, customerId }));

    return {
      user,
      pendingPassword: {
        toEmail: user.email.value,
        toName: user.name,
        password: generatedPassword,
      },
    };
  }

  private async sendInitialPasswordAndAudit(
    user: User,
    customer: LinkedCustomerOutputDto,
    pendingPassword: PendingPassword | null,
    customerId: string,
    actingUserId: string,
  ): Promise<GrantCustomerAccessOutputDto> {
    const initialPasswordSent = pendingPassword
      ? await this.sendInitialPasswordEmail(user.id, pendingPassword)
      : false;

    this.logger.event(BUSINESS_EVENTS.CUSTOMER_ACCESS_GRANTED, {
      subjectId: actingUserId,
      targetUserId: user.id,
      customerId,
      accessUserCreated: pendingPassword !== null,
      initialPasswordSent,
    });

    return {
      user: user.toPublicView(),
      customer,
      initialPasswordSent,
    };
  }

  private resolvePersonData(customer: Customer, input?: GrantCustomerAccessDto): PersonData {
    if (customer.type === CustomerType.INDIVIDUAL) {
      return { name: customer.name, email: customer.email.value, cpf: customer.document.value };
    }

    if (!input?.name || !input?.email || !input?.cpf) {
      throw new BusinessRuleViolationException(
        'Nome, e-mail e CPF são obrigatórios para conceder acesso a um cliente do tipo COMPANY',
      );
    }

    return { name: input.name, email: input.email, cpf: input.cpf.replaceAll(/\D/g, '') };
  }

  private async sendInitialPasswordEmail(
    userId: string,
    pending: PendingPassword,
  ): Promise<boolean> {
    try {
      await this.emailSender.send({
        toEmail: pending.toEmail,
        toName: pending.toName,
        subject: 'Seu acesso à Oficina Mecânica foi criado',
        message: {
          text:
            `Olá ${pending.toName},\n\n` +
            `Uma conta foi criada para você acessar a Oficina Mecânica.\n` +
            `Senha inicial: ${pending.password}\n\n` +
            `Recomendamos trocar a senha após o primeiro acesso.\n\n` +
            `Atenciosamente,\nEquipe da Oficina Mecânica`,
          html:
            `<p>Olá <strong>${pending.toName}</strong>,</p>` +
            `<p>Uma conta foi criada para você acessar a Oficina Mecânica.</p>` +
            `<p><strong>Senha inicial:</strong> ${pending.password}</p>` +
            `<p>Recomendamos trocar a senha após o primeiro acesso.</p>` +
            `<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>`,
        },
      });

      return true;
    } catch {
      this.logger.event(BUSINESS_EVENTS.USER_INITIAL_PASSWORD_SEND_FAILED, {
        targetUserId: userId,
      });
      return false;
    }
  }
}
