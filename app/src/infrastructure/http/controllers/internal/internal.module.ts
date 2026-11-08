import { Module } from '@nestjs/common';

import { WorkOrderModule } from '@infrastructure/http/controllers/work-order/work-order.module';
import { QuoteModule } from '@infrastructure/http/controllers/quote/quote.module';

import { InternalWorkOrderController } from './internal-work-order.controller';
import { InternalQuoteController } from './internal-quote.controller';

@Module({
  imports: [WorkOrderModule, QuoteModule],
  controllers: [InternalWorkOrderController, InternalQuoteController],
})
export class InternalModule {}
