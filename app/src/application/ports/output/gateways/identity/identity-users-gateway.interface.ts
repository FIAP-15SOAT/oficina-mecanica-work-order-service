import {
  EnsureCustomerUserGatewayResponse,
  IdentityUserGatewayResponse,
} from './identity-users-gateway.response';

export interface IIdentityUsersGateway {
  findById(id: string): Promise<IdentityUserGatewayResponse | null>;
  findByIds(ids: readonly string[]): Promise<IdentityUserGatewayResponse[]>;
  ensureCustomerUser(input: {
    name: string;
    email: string;
    cpf: string;
  }): Promise<EnsureCustomerUserGatewayResponse>;
}
