import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '@infrastructure/http/decorators/public.decorator';
import { INTERNAL_PREFIX } from '@infrastructure/http/http.constants';

import { InternalQuoteController as InternalQuoteCleanController } from '@interface-adapters/quote/internal-quote.controller';
import { InternalQuoteUsageDataResponse } from '@interface-adapters/quote/responses/internal-quote.response';

@ApiExcludeController()
@Public()
@Controller(INTERNAL_PREFIX)
export class InternalQuoteController {
  constructor(private readonly controller: InternalQuoteCleanController) {}

  @Get('services/:serviceId/quote-usage')
  findServiceQuoteUsage(
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ): Promise<InternalQuoteUsageDataResponse> {
    return this.controller.findServiceQuoteUsage(serviceId);
  }

  @Get('parts-supplies/:partSupplyId/quote-usage')
  findPartSupplyQuoteUsage(
    @Param('partSupplyId', ParseUUIDPipe) partSupplyId: string,
  ): Promise<InternalQuoteUsageDataResponse> {
    return this.controller.findPartSupplyQuoteUsage(partSupplyId);
  }
}
