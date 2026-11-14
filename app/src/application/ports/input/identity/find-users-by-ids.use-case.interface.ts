import { IdentityUserGatewayResponse } from '@application/ports/output/gateways/identity/identity-users-gateway.response';

export interface IFindUsersByIdsUseCase {
  execute(ids: readonly string[]): Promise<IdentityUserGatewayResponse[]>;
}
