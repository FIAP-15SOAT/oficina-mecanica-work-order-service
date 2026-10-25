import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';

import { InternalHttpClient } from './internal-http-client';

@Global()
@Module({
  imports: [HttpModule],
  providers: [{ provide: 'IInternalHttpClient', useClass: InternalHttpClient }],
  exports: ['IInternalHttpClient'],
})
export class ClientsModule {}
