import { IdentityUserGatewayResponse } from '@application/ports/output/gateways/identity/identity-users-gateway.response';
import { LinkedCustomerOutputDto } from '@application/ports/input/customer-access/dto/list-user-customers.dto';

export interface GrantCustomerAccessDto {
  name?: string;
  email?: string;
  cpf?: string;
}

export type AccessUserOutputDto = IdentityUserGatewayResponse;

export interface GrantCustomerAccessOutputDto {
  user: AccessUserOutputDto;
  customer: LinkedCustomerOutputDto;
  initialPasswordSent: boolean;
}
