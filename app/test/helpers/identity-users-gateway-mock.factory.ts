import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import {
  EnsureCustomerUserGatewayResponse,
  IdentityUserGatewayResponse,
} from '@application/ports/output/gateways/identity/identity-users-gateway.response';

export interface InternalUserFixture {
  data: IdentityUserGatewayResponse;
}

export interface InternalCustomerUserFixture {
  data: EnsureCustomerUserGatewayResponse;
}

function readFixture<T>(file: string): T {
  return JSON.parse(readFileSync(join(__dirname, '../contracts/identity', file), 'utf8')) as T;
}

export function readInternalUserFixture(): InternalUserFixture {
  return readFixture('internal-user.json');
}

export function readInternalCustomerUserFixture(): InternalCustomerUserFixture {
  return readFixture('internal-customer-user.json');
}

export function createMockIdentityUsersGateway(): jest.Mocked<IIdentityUsersGateway> {
  return { findById: jest.fn(), findByIds: jest.fn(), ensureCustomerUser: jest.fn() };
}

export function createMockIdentityUserGatewayResponse(
  overrides: Partial<IdentityUserGatewayResponse> = {},
): IdentityUserGatewayResponse {
  return { ...readInternalUserFixture().data, id: randomUUID(), ...overrides };
}
