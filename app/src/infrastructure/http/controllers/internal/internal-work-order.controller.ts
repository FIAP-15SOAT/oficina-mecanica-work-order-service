import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '@infrastructure/http/decorators/public.decorator';
import { INTERNAL_PREFIX } from '@infrastructure/http/http.constants';

import { WorkOrderController as WorkOrderCleanController } from '@interface-adapters/work-order/work-order.controller';
import { WorkOrderDataResponse } from '@interface-adapters/work-order/responses/work-order.response';

@ApiExcludeController()
@Public()
@Controller(`${INTERNAL_PREFIX}/work-orders`)
export class InternalWorkOrderController {
  constructor(private readonly controller: WorkOrderCleanController) {}

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<WorkOrderDataResponse> {
    return this.controller.findOne(id);
  }
}
