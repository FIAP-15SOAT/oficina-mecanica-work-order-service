import { Vehicle } from '@domain/entities/vehicle.entity';
import { Plate } from '@domain/value-objects/plate.vo';

import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IVehicleRepository } from '@domain/interfaces/repositories/vehicle.repository.interface';

import { IUpdateVehicleUseCase } from '@application/ports/input/vehicle/update-vehicle.use-case.interface';
import { UpdateVehicleDto } from '@application/ports/input/vehicle/dto/update-vehicle.dto';

import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

export class UpdateVehicleUseCase implements IUpdateVehicleUseCase {
  constructor(
    private readonly vehicleRepository: IVehicleRepository,
    private readonly customerRepository: ICustomerRepository,
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly cache: ICache,
  ) {}

  async execute(id: string, input: UpdateVehicleDto): Promise<Vehicle> {
    const existing = await this.vehicleRepository.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('Veículo', id);
    }

    if (input.customerId !== existing.customerId) {
      const customer = await this.customerRepository.findById(input.customerId);

      if (!customer) {
        throw new ResourceNotFoundException('Cliente', input.customerId);
      }
    }

    await this.validateExistenceByPlate(existing, input);

    existing.update(input);

    // Read before the write: a failed lookup must fail the request before anything is stored.
    const cacheKeys = await this.findWorkOrderCacheKeys(id);

    const updated = await this.vehicleRepository.update(existing);

    await this.cache.delete(cacheKeys);

    return updated;
  }

  private async validateExistenceByPlate(
    existing: Vehicle,
    input: UpdateVehicleDto,
  ): Promise<void> {
    const newPlate = Plate.create(input.plate);

    if (newPlate.equals(existing.plate)) {
      return;
    }

    const existingByPlate = await this.vehicleRepository.findByPlate(newPlate.value);

    if (existingByPlate) {
      throw new ResourceConflictException(`Placa '${newPlate.value}' já está cadastrada.`);
    }
  }

  private async findWorkOrderCacheKeys(vehicleId: string): Promise<string[]> {
    const workOrders = await this.workOrderRepository.findByVehicleId(vehicleId);

    return workOrders.map((workOrder) => workOrderCacheKey(workOrder.id));
  }
}
