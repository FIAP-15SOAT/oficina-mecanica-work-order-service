import { randomUUID } from 'node:crypto';

import { UserRole } from '@domain/enums/user-role.enum';
import type { IdentityUserGatewayResponse } from '@application/ports/output/gateways/identity/identity-users-gateway.response';

import { readInternalUserFixture } from './identity-users-gateway-mock.factory';
import type { InternalServicesStub } from './internal-services-stub';
import { signTestStaffToken } from './staff-jwt.helper';

/** `Authorization` header with a staff access token signed like the Identity signs it. */
export function staffAuthHeader(
  overrides: { sub?: string; email?: string; role?: UserRole } = {},
): string {
  const claims = {
    sub: overrides.sub ?? randomUUID(),
    email: overrides.email ?? `${randomUUID()}@e2e.test`,
    role: overrides.role ?? UserRole.ADMIN,
  };

  return `Bearer ${signTestStaffToken(claims)}`;
}

export interface StaffUser {
  authorization: string;
  user: IdentityUserGatewayResponse;
}

/**
 * Staff user known to the Identity stub, with its signed token.
 */
export function createStaffUser(
  deps: { stub?: InternalServicesStub },
  overrides: { name?: string; email?: string; role?: UserRole; isActive?: boolean } = {},
): StaffUser {
  const role = overrides.role ?? UserRole.ADMIN;
  const user: IdentityUserGatewayResponse = {
    ...readInternalUserFixture().data,
    ...overrides,
    role,
    id: randomUUID(),
    email: overrides.email ?? `${randomUUID()}@e2e.test`,
  };

  deps.stub?.users.set(user.id, user);

  return {
    authorization: staffAuthHeader({ sub: user.id, email: user.email, role }),
    user,
  };
}
