import { IListActiveUserCustomersUseCase } from '@application/ports/input/customer-access/list-active-user-customers.use-case.interface';

import { CustomerAccessPresenter } from './customer-access.presenter';
import { InternalUserCustomerListResponse } from './responses/internal-user-customer.response';

export class InternalUserCustomersController {
  constructor(private readonly listActiveUserCustomersUseCase: IListActiveUserCustomersUseCase) {}

  async listUserCustomers(userId: string): Promise<InternalUserCustomerListResponse> {
    return CustomerAccessPresenter.toInternalUserCustomerListResponse(
      await this.listActiveUserCustomersUseCase.execute(userId),
    );
  }
}
