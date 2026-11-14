import { UserRole } from '@domain/enums/user-role.enum';

export interface IdentityUserGatewayResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole | null;
  isActive: boolean;
}

export interface EnsureCustomerUserGatewayResponse {
  userId: string;
  created: boolean;
}
