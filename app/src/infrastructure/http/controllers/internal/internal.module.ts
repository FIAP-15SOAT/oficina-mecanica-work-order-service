import { Module } from '@nestjs/common';

import { WorkOrderModule } from '@infrastructure/http/controllers/work-order/work-order.module';

import { InternalWorkOrderController } from './internal-work-order.controller';

@Module({
  imports: [WorkOrderModule],
  controllers: [InternalWorkOrderController],
})
export class InternalModule {}
