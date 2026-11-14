import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '@infrastructure/http/decorators/public.decorator';
import { INTERNAL_PREFIX } from '@infrastructure/http/http.constants';

import { InternalUserCustomersController as InternalUserCustomersCleanController } from '@interface-adapters/customer-access/internal-user-customers.controller';
import { InternalUserCustomerListResponse } from '@interface-adapters/customer-access/responses/internal-user-customer.response';

@ApiExcludeController()
@Public()
@Controller(INTERNAL_PREFIX)
export class InternalUserCustomersController {
  constructor(private readonly controller: InternalUserCustomersCleanController) {}

  @Get('users/:userId/customers')
  listUserCustomers(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<InternalUserCustomerListResponse> {
    return this.controller.listUserCustomers(userId);
  }
}
