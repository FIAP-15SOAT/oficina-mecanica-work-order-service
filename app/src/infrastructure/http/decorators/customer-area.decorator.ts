import { SetMetadata } from '@nestjs/common';

export const CUSTOMER_AREA_KEY = 'customerArea';

export type CustomerAreaMode = 'customer' | 'any';

export const CustomerArea = (mode: CustomerAreaMode = 'customer') =>
  SetMetadata(CUSTOMER_AREA_KEY, mode);
