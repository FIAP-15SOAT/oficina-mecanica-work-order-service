import { InternalUserCustomersController } from '@interface-adapters/customer-access/internal-user-customers.controller';
import { IListActiveUserCustomersUseCase } from '@application/ports/input/customer-access/list-active-user-customers.use-case.interface';
import { CustomerType } from '@domain/enums/customer-type.enum';

describe('InternalUserCustomersController', () => {
  let listActiveUserCustomersUseCase: jest.Mocked<IListActiveUserCustomersUseCase>;
  let controller: InternalUserCustomersController;

  beforeEach(() => {
    listActiveUserCustomersUseCase = { execute: jest.fn() };

    controller = new InternalUserCustomersController(listActiveUserCustomersUseCase);
  });

  it('should wrap the active customers of the user in a data property', async () => {
    const customers = [
      {
        id: 'customer-id',
        name: 'João da Silva',
        type: CustomerType.INDIVIDUAL,
        document: '12345678909',
        isActive: true,
      },
    ];

    listActiveUserCustomersUseCase.execute.mockResolvedValue(customers);

    await expect(controller.listUserCustomers('user-id')).resolves.toEqual({ data: customers });

    expect(listActiveUserCustomersUseCase.execute).toHaveBeenCalledWith('user-id');
  });
});
