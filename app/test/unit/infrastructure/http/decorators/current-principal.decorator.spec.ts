import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { UserRole } from '@domain/enums/user-role.enum';
import { AuthFlow } from '@domain/enums/auth-flow.enum';
import { CurrentPrincipal } from '@infrastructure/http/decorators/current-principal.decorator';

class TestController {
  handler(@CurrentPrincipal() _principal: AuthenticatedPrincipal): void {}
}

function getDecoratorFactory() {
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'handler') as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => AuthenticatedPrincipal }
  >;

  return Object.values(metadata)[0].factory;
}

function buildContext(user: AuthenticatedPrincipal): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as ExecutionContext;
}

describe('CurrentPrincipalDecorator', () => {
  let factory: (data: unknown, ctx: ExecutionContext) => AuthenticatedPrincipal;

  beforeEach(() => {
    factory = getDecoratorFactory();
  });

  it('should extract an INTERNAL principal from the request', () => {
    const principal: AuthenticatedPrincipal = {
      sub: 'user-uuid-123',
      authFlow: AuthFlow.INTERNAL,
      email: 'john@example.com',
      role: UserRole.ADMIN,
    };

    const result = factory(null, buildContext(principal));

    expect(result).toEqual(principal);
  });

  it('should extract a CUSTOMER principal from the request, with no role field', () => {
    const principal: AuthenticatedPrincipal = {
      sub: 'user-uuid-456',
      authFlow: AuthFlow.CUSTOMER,
      email: 'cliente@example.com',
    };

    const result = factory(null, buildContext(principal));

    expect(result).toEqual(principal);
    expect(result).not.toHaveProperty('role');
  });

  it('should handle all internal user roles', () => {
    const testRoles = [UserRole.ADMIN, UserRole.MECHANIC, UserRole.ATTENDANT];

    testRoles.forEach((role) => {
      const principal: AuthenticatedPrincipal = {
        sub: `user-${role}`,
        authFlow: AuthFlow.INTERNAL,
        email: `${role.toLowerCase()}@example.com`,
        role,
      };

      const result = factory(null, buildContext(principal));

      expect(result).toEqual(expect.objectContaining({ role }));
    });
  });
});
