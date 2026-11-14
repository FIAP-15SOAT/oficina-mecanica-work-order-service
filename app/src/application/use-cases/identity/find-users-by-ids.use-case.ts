import { IFindUsersByIdsUseCase } from '@application/ports/input/identity/find-users-by-ids.use-case.interface';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { IdentityUserGatewayResponse } from '@application/ports/output/gateways/identity/identity-users-gateway.response';

export class FindUsersByIdsUseCase implements IFindUsersByIdsUseCase {
  constructor(private readonly identityUsersGateway: IIdentityUsersGateway) {}

  execute(ids: readonly string[]): Promise<IdentityUserGatewayResponse[]> {
    return this.identityUsersGateway.findByIds(ids);
  }
}
