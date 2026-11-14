import { UserCustomer } from '@domain/entities/user-customer.entity';
import { Customer } from '@domain/entities/customer.entity';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { EnsureCustomerUserGatewayResponse } from '@application/ports/output/gateways/identity/identity-users-gateway.response';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import {
  GrantCustomerAccessDto,
  GrantCustomerAccessOutputDto,
} from '@application/ports/input/customer-access/dto/grant-customer-access.dto';
import { IGrantCustomerAccessUseCase } from '@application/ports/input/customer-access/grant-customer-access.use-case.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';

export class GrantCustomerAccessUseCase implements IGrantCustomerAccessUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly identityUsersGateway: IIdentityUsersGateway,
    private readonly logger: ILogger,
  ) {}

  async execute(
    customerId: string,
    actingUserId: string,
    input?: GrantCustomerAccessDto,
  ): Promise<GrantCustomerAccessOutputDto> {
    const customer = await this.unitOfWork.executeTransaction((repos) =>
      repos.customer.findById(customerId),
    );

    if (!customer) {
      throw new ResourceNotFoundException('Cliente', customerId);
    }

    const { userId, created } = await this.ensureUser(customer, input);
    const user = await this.identityUsersGateway.findById(userId);

    if (!user) {
      throw new ResourceNotFoundException('Usuário', userId);
    }

    // If this write fails, a retry reuses the identity user by the CPF.
    await this.unitOfWork.executeTransaction((repos) =>
      repos.userCustomer.create(UserCustomer.create({ userId, customerId })),
    );

    this.logger.event(BUSINESS_EVENTS.CUSTOMER_ACCESS_GRANTED, {
      subjectId: actingUserId,
      targetUserId: userId,
      customerId,
      accessUserCreated: created,
      initialPasswordSent: created,
    });

    return {
      user,
      customer: {
        id: customer.id,
        name: customer.name,
        type: customer.type,
        isActive: customer.isActive,
      },
      initialPasswordSent: created,
    };
  }

  /** Finds or creates the access user in the identity, which also sends its initial password. */
  async ensureUser(
    customer: Customer,
    input?: GrantCustomerAccessDto,
  ): Promise<EnsureCustomerUserGatewayResponse> {
    if (!customer.isActive) {
      throw new BusinessRuleViolationException('Cliente inativo não pode receber novos acessos');
    }

    return this.identityUsersGateway.ensureCustomerUser(this.resolvePersonData(customer, input));
  }

  private resolvePersonData(
    customer: Customer,
    input?: GrantCustomerAccessDto,
  ): { name: string; email: string; cpf: string } {
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
}
