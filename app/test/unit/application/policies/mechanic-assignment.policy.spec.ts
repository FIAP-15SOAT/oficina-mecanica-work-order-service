import { randomUUID } from 'node:crypto';

import { MechanicAssignmentPolicy } from '@application/policies/mechanic-assignment.policy';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { UserRole } from '@domain/enums/user-role.enum';

import {
  createMockIdentityUserGatewayResponse,
  createMockIdentityUsersGateway,
} from '../../../helpers/identity-users-gateway-mock.factory';

describe('MechanicAssignmentPolicy', () => {
  let policy: MechanicAssignmentPolicy;
  let identityUsersGateway: jest.Mocked<IIdentityUsersGateway>;

  beforeEach(() => {
    identityUsersGateway = createMockIdentityUsersGateway();

    policy = new MechanicAssignmentPolicy(identityUsersGateway);
  });

  it('should accept an active mechanic', async () => {
    const mechanic = createMockIdentityUserGatewayResponse({
      role: UserRole.MECHANIC,
      isActive: true,
    });

    identityUsersGateway.findById.mockResolvedValue(mechanic);

    await expect(policy.ensureAssignable(mechanic.id)).resolves.toBeUndefined();

    expect(identityUsersGateway.findById).toHaveBeenCalledWith(mechanic.id);
  });

  it.each([
    ['an attendant', { role: UserRole.ATTENDANT, isActive: true }],
    ['an admin', { role: UserRole.ADMIN, isActive: true }],
    ['a customer user', { role: null, isActive: true }],
    ['an inactive mechanic', { role: UserRole.MECHANIC, isActive: false }],
  ])('should reject %s', async (_label, overrides) => {
    const user = createMockIdentityUserGatewayResponse(overrides);

    identityUsersGateway.findById.mockResolvedValue(user);

    const result = policy.ensureAssignable(user.id);

    await expect(result).rejects.toThrow(BusinessRuleViolationException);

    await expect(result).rejects.toThrow(
      'Apenas mecânicos ativos podem ser atribuídos a uma ordem de serviço',
    );
  });

  it('should answer 404 for a user the identity does not find', async () => {
    const id = randomUUID();

    identityUsersGateway.findById.mockResolvedValue(null);

    const result = policy.ensureAssignable(id);

    await expect(result).rejects.toThrow(ResourceNotFoundException);
    await expect(result).rejects.toThrow(`Usuário não encontrado(a) com identificador: ${id}`);
  });

  it('should let an unavailable identity error through', async () => {
    const error = new ServiceIntegrationException('Serviço de destino indisponível');

    identityUsersGateway.findById.mockRejectedValue(error);

    await expect(policy.ensureAssignable(randomUUID())).rejects.toBe(error);
  });
});
