import { Global, Module } from '@nestjs/common';

import { HttpInventoryCatalogGateway } from './inventory/http-inventory-catalog-gateway';

const GATEWAY_PROVIDERS = [
  { provide: 'IInventoryCatalogGateway', useClass: HttpInventoryCatalogGateway },
];

@Global()
@Module({
  providers: GATEWAY_PROVIDERS,
  exports: GATEWAY_PROVIDERS,
})
export class GatewaysModule {}
