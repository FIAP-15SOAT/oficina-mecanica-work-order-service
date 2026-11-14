import { randomUUID } from 'node:crypto';

import { FindUsersByIdsUseCase } from '@application/use-cases/identity/find-users-by-ids.use-case';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';

import {
  createMockIdentityUserGatewayResponse,
  createMockIdentityUsersGateway,
} from '../../../../helpers/identity-users-gateway-mock.factory';

describe('FindUsersByIdsUseCase', () => {
  let useCase: FindUsersByIdsUseCase;
  let identityUsersGateway: jest.Mocked<IIdentityUsersGateway>;

  beforeEach(() => {
    identityUsersGateway = createMockIdentityUsersGateway();
    useCase = new FindUsersByIdsUseCase(identityUsersGateway);
  });

  it('should return the users the identity finds for the ids', async () => {
    const user = createMockIdentityUserGatewayResponse();
    const ids = [user.id, randomUUID()];

    identityUsersGateway.findByIds.mockResolvedValue([user]);

    const result = await useCase.execute(ids);

    expect(result).toEqual([user]);
    expect(identityUsersGateway.findByIds).toHaveBeenCalledWith(ids);
  });
});
