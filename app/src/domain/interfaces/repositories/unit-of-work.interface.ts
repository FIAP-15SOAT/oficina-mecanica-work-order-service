import { ICustomerRepository } from './customer.repository.interface';
import { IVehicleRepository } from './vehicle.repository.interface';
import { IWorkOrderRepository } from './work-order.repository.interface';
import { IQuoteRepository } from './quote.repository.interface';
import { IStatusHistoryRepository } from './status-history.repository.interface';
import { IStockReservationRepository } from './stock-reservation.repository.interface';
import { IStockMovementRepository } from './stock-movement.repository.interface';
import { IPartSupplyRepository } from './part-supply.repository.interface';
import { IServiceRepository } from './service.repository.interface';
import { IUserRepository } from './user.repository.interface';
import { IUserCustomerRepository } from './user-customer.repository.interface';
import { IPasswordResetCodeRepository } from './password-reset-code.repository.interface';
import { IOutboxRepository } from './outbox.repository.interface';

export interface IRepositories {
  customer: ICustomerRepository;
  vehicle: IVehicleRepository;
  workOrder: IWorkOrderRepository;
  quote: IQuoteRepository;
  statusHistory: IStatusHistoryRepository;
  stockReservation: IStockReservationRepository;
  stockMovement: IStockMovementRepository;
  partSupply: IPartSupplyRepository;
  service: IServiceRepository;
  user: IUserRepository;
  userCustomer: IUserCustomerRepository;
  passwordResetCode: IPasswordResetCodeRepository;
  outbox: IOutboxRepository;
}

export interface IUnitOfWork {
  executeTransaction<T>(work: (repositories: IRepositories) => Promise<T>): Promise<T>;
}
