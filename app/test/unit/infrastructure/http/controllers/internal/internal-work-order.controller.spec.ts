import { InternalWorkOrderController } from '@infrastructure/http/controllers/internal/internal-work-order.controller';
import { WorkOrderController as WorkOrderCleanController } from '@interface-adapters/work-order/work-order.controller';
import { WorkOrderPresenter } from '@interface-adapters/work-order/work-order.presenter';

import { createMockCustomer } from '../../../../../helpers/customer-mock.factory';
import { createMockVehicle } from '../../../../../helpers/vehicle-mock.factory';
import { createMockWorkOrder } from '../../../../../helpers/work-order-mock.factory';

describe('InternalWorkOrderController', () => {
  let httpController: InternalWorkOrderController;
  let cleanController: WorkOrderCleanController;

  beforeEach(() => {
    cleanController = new WorkOrderCleanController(
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
    );
    httpController = new InternalWorkOrderController(cleanController);
  });

  describe('findOne', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const workOrder = createMockWorkOrder({
        customer: createMockCustomer(),
        vehicle: createMockVehicle(),
      });

      const response = WorkOrderPresenter.toDataResponse(workOrder);

      jest.spyOn(cleanController, 'findOne').mockResolvedValue(response);

      const result = await httpController.findOne(workOrder.id);

      expect(result).toBe(response);
      expect(cleanController.findOne).toHaveBeenCalledWith(workOrder.id);
    });
  });
});
