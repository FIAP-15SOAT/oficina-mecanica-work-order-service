import { UserRole } from '@domain/enums/user-role.enum';
import { AuthFlow } from '@domain/enums/auth-flow.enum';

/**
 * authFlow is always set by the Passport strategy that validated the token
 * (JwtStrategy or CustomerJwtStrategy) — never read from the token itself,
 * so the value does not depend on what the client presented.
 */
export type AuthenticatedPrincipal =
  | { sub: string; authFlow: AuthFlow.INTERNAL; email: string; role: UserRole }
  | { sub: string; authFlow: AuthFlow.CUSTOMER; email: string };
