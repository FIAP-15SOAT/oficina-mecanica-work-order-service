import { SetMetadata } from '@nestjs/common';

export const CUSTOMER_AREA_KEY = 'customerArea';

export const CustomerArea = () => SetMetadata(CUSTOMER_AREA_KEY, true);
