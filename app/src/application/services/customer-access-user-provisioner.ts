import { Customer } from '@domain/entities/customer.entity';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';

import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { EnsureCustomerUserGatewayResponse } from '@application/ports/output/gateways/identity/identity-users-gateway.response';
import { GrantCustomerAccessDto } from '@application/ports/input/customer-access/dto/grant-customer-access.dto';

export class CustomerAccessUserProvisioner {
  constructor(private readonly identityUsersGateway: IIdentityUsersGateway) {}

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
