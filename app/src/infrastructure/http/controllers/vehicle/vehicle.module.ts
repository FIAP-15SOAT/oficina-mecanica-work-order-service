import { Module } from '@nestjs/common';

import { CreateVehicleUseCase } from '@application/use-cases/vehicle/create-vehicle.use-case';
import { FindAllVehiclesUseCase } from '@application/use-cases/vehicle/find-all-vehicles.use-case';
import { FindVehicleByIdUseCase } from '@application/use-cases/vehicle/find-vehicle-by-id.use-case';
import { UpdateVehicleUseCase } from '@application/use-cases/vehicle/update-vehicle.use-case';
import { DeleteVehicleUseCase } from '@application/use-cases/vehicle/delete-vehicle.use-case';
import { FindVehiclesByCustomerIdUseCase } from '@application/use-cases/vehicle/find-vehicles-by-customer-id.use-case';

import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IVehicleRepository } from '@domain/interfaces/repositories/vehicle.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';

import { VehicleController as VehicleCleanController } from '@interface-adapters/vehicle/vehicle.controller';
import { VehicleController } from './vehicle.controller';
import { CustomerVehiclesController } from './customer-vehicles.controller';

@Module({
  controllers: [VehicleController, CustomerVehiclesController],
  providers: [
    {
      provide: VehicleCleanController,
      useFactory: (
        vehicleRepository: IVehicleRepository,
        customerRepository: ICustomerRepository,
        workOrderRepository: IWorkOrderRepository,
        cache: ICache,
      ) =>
        new VehicleCleanController(
          new CreateVehicleUseCase(vehicleRepository, customerRepository),
          new FindAllVehiclesUseCase(vehicleRepository),
          new FindVehicleByIdUseCase(vehicleRepository),
          new UpdateVehicleUseCase(
            vehicleRepository,
            customerRepository,
            workOrderRepository,
            cache,
          ),
          new DeleteVehicleUseCase(vehicleRepository),
          new FindVehiclesByCustomerIdUseCase(vehicleRepository, customerRepository),
        ),
      inject: ['IVehicleRepository', 'ICustomerRepository', 'IWorkOrderRepository', 'ICache'],
    },
  ],
})
export class VehicleModule {}
