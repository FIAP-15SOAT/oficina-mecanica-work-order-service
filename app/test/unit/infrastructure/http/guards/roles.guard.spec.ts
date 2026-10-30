import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RolesGuard } from '@infrastructure/http/guards/roles.guard';
import { UserRole } from '@domain/enums/user-role.enum';

import { ROLES_KEY } from '@infrastructure/http/decorators/roles.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;
  let mockExecutionContext: ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    guard = new RolesGuard(reflector);

    mockExecutionContext = {
      switchToHttp: jest.fn().mockReturnThis(),
      getRequest: jest.fn(),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
  });

  it('should allow access when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const result = guard.canActivate(mockExecutionContext);

    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      mockExecutionContext.getHandler(),
      mockExecutionContext.getClass(),
    ]);
  });

  it('should allow access when roles array is empty', () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    const result = guard.canActivate(mockExecutionContext);

    expect(result).toBe(true);
  });

  it('should allow access when user has required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: { role: UserRole.ADMIN },
    });

    const result = guard.canActivate(mockExecutionContext);

    expect(result).toBe(true);
  });

  it('should deny access when user does not have required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: { role: UserRole.ATTENDANT },
    });

    const result = guard.canActivate(mockExecutionContext);

    expect(result).toBe(false);
  });

  it('should allow access when user has one of multiple required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN, UserRole.MECHANIC]);

    (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: { role: UserRole.MECHANIC },
    });

    const result = guard.canActivate(mockExecutionContext);

    expect(result).toBe(true);
  });

  it('should deny access when user does not have any of multiple required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN, UserRole.MECHANIC]);

    (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: { role: UserRole.ATTENDANT },
    });

    const result = guard.canActivate(mockExecutionContext);

    expect(result).toBe(false);
  });

  it('should check roles from both handler and class', () => {
    const mockHandler = jest.fn();
    const mockClass = jest.fn();

    (mockExecutionContext.getHandler as jest.Mock).mockReturnValue(mockHandler);
    (mockExecutionContext.getClass as jest.Mock).mockReturnValue(mockClass);

    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: { role: UserRole.ADMIN },
    });

    guard.canActivate(mockExecutionContext);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [mockHandler, mockClass]);
  });
});
