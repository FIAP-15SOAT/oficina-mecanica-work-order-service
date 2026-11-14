import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CUSTOMER_AREA_KEY } from '@infrastructure/http/decorators/customer-area.decorator';
import { IS_PUBLIC_KEY } from '@infrastructure/http/decorators/public.decorator';
import { CustomerJwtAuthGuard } from '@infrastructure/http/guards/customer-jwt-auth.guard';
import { JwtAuthGuard } from '@infrastructure/http/guards/jwt-auth.guard';

/** Global guard: every route requires the staff token unless marked @Public() or @CustomerArea(). */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly staff: JwtAuthGuard,
    private readonly customer: CustomerJwtAuthGuard,
  ) {}

  canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const customerArea = this.reflector.getAllAndOverride<boolean>(CUSTOMER_AREA_KEY, targets);

    return (customerArea ? this.customer : this.staff).canActivate(context);
  }
}
