import { CustomerType } from '@domain/enums/customer-type.enum';

export interface ActiveUserCustomerOutputDto {
  id: string;
  name: string;
  type: CustomerType;
  document: string;
  isActive: boolean;
}
