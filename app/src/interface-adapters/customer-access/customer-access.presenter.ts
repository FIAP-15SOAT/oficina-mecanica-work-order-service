import {
  AccessUserOutputDto,
  GrantCustomerAccessOutputDto,
} from '@application/ports/input/customer-access/dto/grant-customer-access.dto';
import { LinkedCustomerOutputDto } from '@application/ports/input/customer-access/dto/list-user-customers.dto';
import { ActiveUserCustomerOutputDto } from '@application/ports/input/customer-access/dto/list-active-user-customers.dto';
import { InternalUserCustomerListResponse } from './responses/internal-user-customer.response';
import {
  AccessUserListResponse,
  CustomerAccessDataResponse,
  LinkedCustomerListResponse,
} from './responses/customer-access.response';

export class CustomerAccessPresenter {
  static toDataResponse(result: GrantCustomerAccessOutputDto): CustomerAccessDataResponse {
    return { data: result };
  }

  static toAccessUserListResponse(users: AccessUserOutputDto[]): AccessUserListResponse {
    return { data: users };
  }

  static toLinkedCustomerListResponse(
    customers: LinkedCustomerOutputDto[],
  ): LinkedCustomerListResponse {
    return { data: customers };
  }

  static toInternalUserCustomerListResponse(
    customers: ActiveUserCustomerOutputDto[],
  ): InternalUserCustomerListResponse {
    return { data: customers };
  }
}
