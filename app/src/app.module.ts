import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';

import { AllExceptionsFilter } from './infrastructure/http/filters/all-exceptions.filter';
import { ApplicationExceptionFilter } from './infrastructure/http/filters/application-exception.filter';
import { DomainExceptionFilter } from './infrastructure/http/filters/domain-exception.filter';
import { InfrastructureExceptionFilter } from './infrastructure/http/filters/infrastructure-exception.filter';
import { AuthenticationGuard } from './infrastructure/http/guards/authentication.guard';
import { CustomerJwtAuthGuard } from './infrastructure/http/guards/customer-jwt-auth.guard';
import { JwtAuthGuard } from './infrastructure/http/guards/jwt-auth.guard';
import { JwtStrategy } from './infrastructure/http/strategies/jwt.strategy';
import { CustomerJwtStrategy } from './infrastructure/http/strategies/customer-jwt.strategy';

import { LoggingModule } from './infrastructure/logging/logging.module';
import { TelemetryModule } from './infrastructure/telemetry/telemetry.module';
import { PrismaModule } from './infrastructure/persistence/prisma/prisma.module';
import { RepositoriesModule } from './infrastructure/persistence/prisma/repositories/repositories.module';
import { HealthModule } from './infrastructure/http/controllers/health/health.module';
import { ServiceModule } from './infrastructure/http/controllers/service/service.module';
import { CustomerModule } from './infrastructure/http/controllers/customer/customer.module';
import { CustomerAccessModule } from './infrastructure/http/controllers/customer-access/customer-access.module';
import { VehicleModule } from './infrastructure/http/controllers/vehicle/vehicle.module';
import { WorkOrderModule } from './infrastructure/http/controllers/work-order/work-order.module';
import { MeModule } from './infrastructure/http/controllers/me/me.module';
import { InternalModule } from './infrastructure/http/controllers/internal/internal.module';
import { MessagingModule } from './infrastructure/messaging/messaging.module';
import { PaymentMessagingModule } from './infrastructure/messaging/handlers/payment/payment-messaging.module';
import { QuoteApprovalMessagingModule } from './infrastructure/messaging/handlers/quote-approval/quote-approval-messaging.module';
import { QuoteMessagingModule } from './infrastructure/messaging/handlers/quote/quote-messaging.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { ClientsModule } from './infrastructure/clients/clients.module';
import { GatewaysModule } from './infrastructure/gateways/gateways.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggingModule,
    TelemetryModule,
    PrismaModule,
    RepositoriesModule,
    MessagingModule,
    CacheModule,
    ClientsModule,
    GatewaysModule,
    HealthModule,
    ServiceModule,
    CustomerModule,
    CustomerAccessModule,
    VehicleModule,
    WorkOrderModule,
    QuoteApprovalMessagingModule,
    QuoteMessagingModule,
    PaymentMessagingModule,
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
    JwtStrategy,
    CustomerJwtStrategy,
    JwtAuthGuard,
    CustomerJwtAuthGuard,
    {
      provide: APP_GUARD,
      useClass: AuthenticationGuard,
    },
  ],
})
export class AppModule {}
