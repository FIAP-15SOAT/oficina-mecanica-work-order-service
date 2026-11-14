import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { UserRole } from '@domain/enums/user-role.enum';

export class MechanicAssignmentPolicy {
  constructor(private readonly identityUsersGateway: IIdentityUsersGateway) {}

  async ensureAssignable(userId: string): Promise<void> {
    const user = await this.identityUsersGateway.findById(userId);

    if (!user) {
      throw new ResourceNotFoundException('Usuário', userId);
    }

    if (user.role !== UserRole.MECHANIC || !user.isActive) {
      throw new BusinessRuleViolationException(
        'Apenas mecânicos ativos podem ser atribuídos a uma ordem de serviço',
      );
    }
  }
}
