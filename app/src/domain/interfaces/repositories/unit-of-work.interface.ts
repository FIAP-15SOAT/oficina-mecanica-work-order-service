import { ICustomerRepository } from './customer.repository.interface';
import { IVehicleRepository } from './vehicle.repository.interface';
import { IWorkOrderRepository } from './work-order.repository.interface';
import { IStatusHistoryRepository } from './status-history.repository.interface';
import { IUserCustomerRepository } from './user-customer.repository.interface';
import { IOutboxRepository } from './outbox.repository.interface';
import { ISagaInstanceRepository } from './saga-instance.repository.interface';

export interface IRepositories {
  customer: ICustomerRepository;
  vehicle: IVehicleRepository;
  workOrder: IWorkOrderRepository;
  statusHistory: IStatusHistoryRepository;
  userCustomer: IUserCustomerRepository;
  outbox: IOutboxRepository;
  sagaInstance: ISagaInstanceRepository;
}

export interface IUnitOfWork {
  executeTransaction<T>(work: (repositories: IRepositories) => Promise<T>): Promise<T>;
}
