import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';

import { AllExceptionsFilter } from './infrastructure/http/filters/all-exceptions.filter';
import { ApplicationExceptionFilter } from './infrastructure/http/filters/application-exception.filter';
import { DomainExceptionFilter } from './infrastructure/http/filters/domain-exception.filter';
import { InfrastructureExceptionFilter } from './infrastructure/http/filters/infrastructure-exception.filter';

import { LoggingModule } from './infrastructure/logging/logging.module';
import { TelemetryModule } from './infrastructure/telemetry/telemetry.module';
import { PrismaModule } from './infrastructure/persistence/prisma/prisma.module';
import { RepositoriesModule } from './infrastructure/persistence/prisma/repositories/repositories.module';
import { HealthModule } from './infrastructure/http/controllers/health/health.module';
import { AuthModule } from './infrastructure/http/controllers/auth/auth.module';
import { UserModule } from './infrastructure/http/controllers/user/user.module';
import { ServiceModule } from './infrastructure/http/controllers/service/service.module';
import { PartSupplyModule } from './infrastructure/http/controllers/part-supply/part-supply.module';
import { CustomerModule } from './infrastructure/http/controllers/customer/customer.module';
import { CustomerAccessModule } from './infrastructure/http/controllers/customer-access/customer-access.module';
import { VehicleModule } from './infrastructure/http/controllers/vehicle/vehicle.module';
import { WorkOrderModule } from './infrastructure/http/controllers/work-order/work-order.module';
import { QuoteModule } from './infrastructure/http/controllers/quote/quote.module';
import { StockModule } from './infrastructure/http/controllers/stock/stock.module';
import { MeModule } from './infrastructure/http/controllers/me/me.module';
import { InternalModule } from './infrastructure/http/controllers/internal/internal.module';
import { MessagingModule } from './infrastructure/messaging/messaging.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { ClientsModule } from './infrastructure/clients/clients.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('MAIL_HOST', 'localhost'),
          port: Number.parseInt(config.get<string>('MAIL_PORT', '1025'), 10),
          ignoreTLS: true,
          secure: false,
        },
        defaults: {
          from: config.get<string>('MAIL_FROM', '"Oficina Mecânica" <noreply@oficina.local>'),
        },
      }),
    }),
    LoggingModule,
    TelemetryModule,
    PrismaModule,
    RepositoriesModule,
    MessagingModule,
    CacheModule,
    ClientsModule,
    HealthModule,
    AuthModule,
    UserModule,
    ServiceModule,
    PartSupplyModule,
    CustomerModule,
    CustomerAccessModule,
    VehicleModule,
    WorkOrderModule,
    QuoteModule,
    StockModule,
    MeModule,
    InternalModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: ApplicationExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: InfrastructureExceptionFilter,
    },
  ],
})
export class AppModule {}
