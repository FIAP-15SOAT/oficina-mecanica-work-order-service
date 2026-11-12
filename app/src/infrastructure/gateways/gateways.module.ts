import { Global, Module } from '@nestjs/common';

import { HttpBillingQuotesGateway } from './billing/http-billing-quotes-gateway';
import { HttpInventoryCatalogGateway } from './inventory/http-inventory-catalog-gateway';

const GATEWAY_PROVIDERS = [
  { provide: 'IInventoryCatalogGateway', useClass: HttpInventoryCatalogGateway },
  { provide: 'IBillingQuotesGateway', useClass: HttpBillingQuotesGateway },
];

@Global()
@Module({
  providers: GATEWAY_PROVIDERS,
  exports: GATEWAY_PROVIDERS,
})
export class GatewaysModule {}
