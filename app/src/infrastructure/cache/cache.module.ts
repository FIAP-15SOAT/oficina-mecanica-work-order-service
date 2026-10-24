import { Global, Module } from '@nestjs/common';

import { ValkeyCacheAdapter } from './valkey-cache.adapter';

@Global()
@Module({
  providers: [{ provide: 'ICache', useClass: ValkeyCacheAdapter }],
  exports: ['ICache'],
})
export class CacheModule {}
