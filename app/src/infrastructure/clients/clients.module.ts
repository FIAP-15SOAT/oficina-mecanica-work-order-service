import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';

import { InternalHttpClient } from './internal-http-client';

@Global()
@Module({
  imports: [HttpModule],
  providers: [InternalHttpClient],
  exports: [InternalHttpClient],
})
export class ClientsModule {}
