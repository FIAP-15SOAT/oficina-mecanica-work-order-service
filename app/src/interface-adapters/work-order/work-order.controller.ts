import { ICreateWorkOrderUseCase } from '@application/ports/input/work-order/create-work-order.use-case.interface';
import { IFindWorkOrderByIdUseCase } from '@application/ports/input/work-order/find-work-order-by-id.use-case.interface';
import { IFindAllWorkOrdersPaginatedUseCase } from '@application/ports/input/work-order/find-all-work-orders-paginated.use-case.interface';
import { IUpdateWorkOrderUseCase } from '@application/ports/input/work-order/update-work-order.use-case.interface';
import { IUpdateWorkOrderStatusUseCase } from '@application/ports/input/work-order/update-work-order-status.use-case.interface';
import { IUpdateWorkOrderServiceStatusUseCase } from '@application/ports/input/work-order/update-work-order-service-status.use-case.interface';
import { IFindWorkOrderStatusHistoryUseCase } from '@application/ports/input/work-order/find-work-order-status-history.use-case.interface';
import { IFindCatalogItemsUseCase } from '@application/ports/input/catalog/find-catalog-items.use-case.interface';
import { IFindUsersByIdsUseCase } from '@application/ports/input/identity/find-users-by-ids.use-case.interface';
import { IdentityUserGatewayResponse } from '@application/ports/output/gateways/identity/identity-users-gateway.response';
import { FindCatalogItemsOutputDto } from '@application/ports/input/catalog/dto/find-catalog-items.dto';

import { CreateWorkOrderRequest } from './requests/create-work-order-request';
import { UpdateWorkOrderRequest } from './requests/update-work-order-request';
import { FindAllWorkOrdersQuery } from './requests/find-all-work-orders-query';
import { UpdateWorkOrderStatusRequest } from './requests/update-work-order-status-request';
import { UpdateWorkOrderServiceStatusRequest } from './requests/update-work-order-service-status-request';

import { WorkOrder } from '@domain/entities/work-order.entity';

import { WorkOrderPresenter } from './work-order.presenter';
import {
  WorkOrderDataResponse,
  WorkOrderPaginatedResponse,
  WorkOrderServiceItemDataResponse,
} from './responses/work-order.response';
import { StatusHistoryListResponse } from './responses/status-history.response';

export class WorkOrderController {
  constructor(
    private readonly createWorkOrderUseCase: ICreateWorkOrderUseCase,
    private readonly findWorkOrderByIdUseCase: IFindWorkOrderByIdUseCase,
    private readonly findAllWorkOrdersPaginatedUseCase: IFindAllWorkOrdersPaginatedUseCase,
    private readonly updateWorkOrderUseCase: IUpdateWorkOrderUseCase,
    private readonly updateWorkOrderStatusUseCase: IUpdateWorkOrderStatusUseCase,
    private readonly updateWorkOrderServiceStatusUseCase: IUpdateWorkOrderServiceStatusUseCase,
    private readonly findWorkOrderStatusHistoryUseCase: IFindWorkOrderStatusHistoryUseCase,
    private readonly findCatalogItemsUseCase: IFindCatalogItemsUseCase,
    private readonly findUsersByIdsUseCase: IFindUsersByIdsUseCase,
  ) {}

  async create(input: CreateWorkOrderRequest, userId: string): Promise<WorkOrderDataResponse> {
    // Read before the write: an unavailable identity fails the request with nothing saved.
    const users = await this.findUsers([input.assignedUserId ?? null]);

    const workOrder = await this.createWorkOrderUseCase.execute({ ...input, userId });

    return this.toDataResponse(workOrder, users);
  }

  async findAll(query: FindAllWorkOrdersQuery): Promise<WorkOrderPaginatedResponse> {
    const result = await this.findAllWorkOrdersPaginatedUseCase.execute({
      ...query,
      page: query.page ?? 1,
      limit: query.limit ?? 10,
    });

    const users = await this.findUsers(result.items.map((item) => item.assignedUserId));

    return WorkOrderPresenter.toPaginatedResponse(result, users);
  }

  async findOne(id: string): Promise<WorkOrderDataResponse> {
    const workOrder = await this.findWorkOrderByIdUseCase.execute(id);

    return this.toDataResponse(workOrder, this.findUsers([workOrder.assignedUserId]));
  }

  async update(
    id: string,
    input: UpdateWorkOrderRequest,
    userId: string,
  ): Promise<WorkOrderDataResponse> {
    // Read before the write: an unavailable identity fails the request with nothing saved.
    const assignedUserId = input.assignedUserId
      ? input.assignedUserId
      : (await this.findWorkOrderByIdUseCase.execute(id)).assignedUserId;

    const users = await this.findUsers([assignedUserId]);

    const workOrder = await this.updateWorkOrderUseCase.execute(id, { ...input, userId });

    return this.toDataResponse(workOrder, users);
  }

  async updateStatus(
    id: string,
    input: UpdateWorkOrderStatusRequest,
    userId: string,
  ): Promise<WorkOrderDataResponse> {
    // Read before the write: an unavailable inventory or identity fails the request with nothing saved.
    const current = await this.findWorkOrderByIdUseCase.execute(id);
    const [catalog, users] = await Promise.all([
      this.findItemsCatalog(current),
      this.findUsers([current.assignedUserId]),
    ]);

    const workOrder = await this.updateWorkOrderStatusUseCase.execute(id, {
      status: input.status,
      notes: input.notes,
      userId,
    });

    return WorkOrderPresenter.toDataResponse(workOrder, catalog, users);
  }

  async updateServiceStatus(
    workOrderId: string,
    serviceId: string,
    input: UpdateWorkOrderServiceStatusRequest,
    userId: string,
  ): Promise<WorkOrderServiceItemDataResponse> {
    const catalog = await this.findCatalogItemsUseCase.execute({
      serviceIds: [serviceId],
      partSupplyIds: [],
    });

    const result = await this.updateWorkOrderServiceStatusUseCase.execute({
      workOrderId,
      serviceId,
      status: input.status,
      userId,
    });

    return WorkOrderPresenter.toServiceItemDataResponse(result, catalog);
  }

  async getStatusHistory(id: string): Promise<StatusHistoryListResponse> {
    const history = await this.findWorkOrderStatusHistoryUseCase.execute(id);
    const users = await this.findUsers(history.map((entry) => entry.changedById));

    return WorkOrderPresenter.toStatusHistoryListResponse(history, users);
  }

  private async toDataResponse(
    workOrder: WorkOrder,
    usersLookup: IdentityUserGatewayResponse[] | Promise<IdentityUserGatewayResponse[]>,
  ): Promise<WorkOrderDataResponse> {
    const [catalog, users] = await Promise.all([this.findItemsCatalog(workOrder), usersLookup]);

    return WorkOrderPresenter.toDataResponse(workOrder, catalog, users);
  }

  private findUsers(ids: (string | null)[]): Promise<IdentityUserGatewayResponse[]> {
    const distinctIds = new Set(ids.filter((id): id is string => id !== null));

    return this.findUsersByIdsUseCase.execute([...distinctIds]);
  }

  private findItemsCatalog(workOrder: WorkOrder): Promise<FindCatalogItemsOutputDto> {
    return this.findCatalogItemsUseCase.execute({
      serviceIds: workOrder.services.map((item) => item.serviceId),
      partSupplyIds: workOrder.partSupplies.map((item) => item.partSupplyId),
    });
  }
}
