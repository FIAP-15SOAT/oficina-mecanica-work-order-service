import { Service } from '../../entities/service.entity';
import { PaginatedRepositoryResult, PaginationInput } from '../common/pagination.interface';

export interface ServiceFilters {
  name?: string;
}

export interface IServiceRepository {
  create(service: Service): Promise<Service>;
  findById(id: string): Promise<Service | null>;
  findByIds(ids: string[]): Promise<Service[]>;
  findByName(name: string): Promise<Service | null>;
  findAllPaginated(
    pagination: PaginationInput,
    filters: ServiceFilters,
  ): Promise<PaginatedRepositoryResult<Service>>;
  update(service: Service): Promise<Service>;
  delete(id: string): Promise<void>;
  isServiceInUse(serviceId: string): Promise<boolean>;
}
