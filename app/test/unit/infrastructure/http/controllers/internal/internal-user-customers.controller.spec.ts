import { InternalUserCustomersController } from '@infrastructure/http/controllers/internal/internal-user-customers.controller';
import { InternalUserCustomersController as InternalUserCustomersCleanController } from '@interface-adapters/customer-access/internal-user-customers.controller';

describe('InternalUserCustomersController (http)', () => {
  let cleanController: InternalUserCustomersCleanController;
  let httpController: InternalUserCustomersController;

  beforeEach(() => {
    cleanController = new InternalUserCustomersCleanController({ execute: jest.fn() });

    httpController = new InternalUserCustomersController(cleanController);
  });

  it('should delegate the active customers of the user', async () => {
    const response = { data: [] };

    jest.spyOn(cleanController, 'listUserCustomers').mockResolvedValue(response);

    await expect(httpController.listUserCustomers('user-id')).resolves.toBe(response);

    expect(cleanController.listUserCustomers).toHaveBeenCalledWith('user-id');
  });
});
