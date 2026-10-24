import { WorkOrder } from '../../entities/work-order.entity';
import { WorkOrderService } from '../../entities/work-order-service.entity';
import { WorkOrderPartSupply } from '../../entities/work-order-part-supply.entity';
import { WorkOrderStatus } from '../../enums/work-order-status.enum';
import { SortCriterion } from '../common/sort-criterion';
import { PaginatedRepositoryResult, PaginationInput } from '../common/pagination.interface';

export interface WorkOrderFilters {
  number?: string;
  customerId?: string;
  customerIdIn?: string[];
  vehicleId?: string;
  assignedUserId?: string;
  status?: WorkOrderStatus;
  statusNotIn?: WorkOrderStatus[];
}

export interface IWorkOrderRepository {
  create(workOrder: WorkOrder): Promise<WorkOrder>;
  findById(id: string): Promise<WorkOrder | null>;
  findByIdWithDetails(id: string): Promise<WorkOrder | null>;
  findByCustomerId(customerId: string): Promise<WorkOrder[]>;
  findByVehicleId(vehicleId: string): Promise<WorkOrder[]>;
  findAllPaginated(
    pagination: PaginationInput,
    filters: WorkOrderFilters,
    sort?: SortCriterion[],
  ): Promise<PaginatedRepositoryResult<WorkOrder>>;
  update(workOrder: WorkOrder): Promise<WorkOrder>;
  generateNextNumber(): Promise<string>;
  addServiceItems(items: WorkOrderService[]): Promise<void>;
  updateServiceItemStatus(workOrder: WorkOrder, item: WorkOrderService): Promise<void>;
  addPartSupplyItems(items: WorkOrderPartSupply[]): Promise<void>;
}
