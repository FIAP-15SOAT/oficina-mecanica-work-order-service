import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  CUSTOMER_AREA_KEY,
  CustomerAreaMode,
} from '@infrastructure/http/decorators/customer-area.decorator';
import { IS_PUBLIC_KEY } from '@infrastructure/http/decorators/public.decorator';
import { AnyAuthGuard } from '@infrastructure/http/guards/any-auth.guard';
import { CustomerJwtAuthGuard } from '@infrastructure/http/guards/customer-jwt-auth.guard';
import { JwtAuthGuard } from '@infrastructure/http/guards/jwt-auth.guard';

/** Global guard: every route requires the staff token unless marked @Public() or @CustomerArea(). */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly staff: JwtAuthGuard,
    private readonly customer: CustomerJwtAuthGuard,
    private readonly any: AnyAuthGuard,
  ) {}

  canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const area = this.reflector.getAllAndOverride<CustomerAreaMode>(CUSTOMER_AREA_KEY, targets);
    const guards = { customer: this.customer, any: this.any };

    return (area ? guards[area] : this.staff).canActivate(context);
  }
}
