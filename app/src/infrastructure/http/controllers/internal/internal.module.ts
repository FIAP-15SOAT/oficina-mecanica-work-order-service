import { Module } from '@nestjs/common';

import { WorkOrderModule } from '@infrastructure/http/controllers/work-order/work-order.module';
import { CustomerAccessModule } from '@infrastructure/http/controllers/customer-access/customer-access.module';

import { InternalWorkOrderController } from './internal-work-order.controller';
import { InternalUserCustomersController } from './internal-user-customers.controller';

@Module({
  imports: [WorkOrderModule, CustomerAccessModule],
  controllers: [InternalWorkOrderController, InternalUserCustomersController],
})
export class InternalModule {}
