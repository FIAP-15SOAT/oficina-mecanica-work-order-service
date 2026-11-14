import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthenticationGuard } from '@infrastructure/http/guards/authentication.guard';
import { CustomerJwtAuthGuard } from '@infrastructure/http/guards/customer-jwt-auth.guard';
import { JwtAuthGuard } from '@infrastructure/http/guards/jwt-auth.guard';
import { CustomerArea } from '@infrastructure/http/decorators/customer-area.decorator';
import { Public } from '@infrastructure/http/decorators/public.decorator';

class RoutesController {
  @Public()
  publicRoute(): void {}

  staffRoute(): void {}

  @CustomerArea()
  customerRoute(): void {}
}

@CustomerArea()
class CustomerAreaController {
  inheritedRoute(): void {}
}

function contextFor(controller: object, handler: (...args: never[]) => void): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

describe('AuthenticationGuard', () => {
  let staff: jest.Mocked<JwtAuthGuard>;
  let customer: jest.Mocked<CustomerJwtAuthGuard>;
  let guard: AuthenticationGuard;

  beforeEach(() => {
    staff = {
      canActivate: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<JwtAuthGuard>;

    customer = {
      canActivate: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CustomerJwtAuthGuard>;

    guard = new AuthenticationGuard(new Reflector(), staff, customer);
  });

  it('should allow a @Public() route without delegating', async () => {
    const result = await guard.canActivate(
      contextFor(RoutesController, RoutesController.prototype.publicRoute),
    );

    expect(result).toBe(true);
    expect(staff.canActivate).not.toHaveBeenCalled();
    expect(customer.canActivate).not.toHaveBeenCalled();
  });

  it('should delegate to the staff guard when the route has no marker', async () => {
    staff.canActivate.mockResolvedValue(false);
    const context = contextFor(RoutesController, RoutesController.prototype.staffRoute);

    const result = await guard.canActivate(context);

    expect(result).toBe(false);
    expect(staff.canActivate).toHaveBeenCalledWith(context);
    expect(customer.canActivate).not.toHaveBeenCalled();
  });

  it('should delegate to the customer guard for @CustomerArea()', async () => {
    const context = contextFor(RoutesController, RoutesController.prototype.customerRoute);

    await guard.canActivate(context);

    expect(customer.canActivate).toHaveBeenCalledWith(context);
    expect(staff.canActivate).not.toHaveBeenCalled();
  });

  it('should read the marker from the class', async () => {
    const context = contextFor(
      CustomerAreaController,
      CustomerAreaController.prototype.inheritedRoute,
    );

    await guard.canActivate(context);

    expect(customer.canActivate).toHaveBeenCalledWith(context);
    expect(staff.canActivate).not.toHaveBeenCalled();
  });
});
