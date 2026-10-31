import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { PartSupply } from '@domain/entities/part-supply.entity';
import { StockMovement } from '@domain/entities/stock-movement.entity';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { UpdateStockDto } from '@application/ports/input/part-supply/dto/update-stock.dto';
import { IUpdateStockUseCase } from '@application/ports/input/part-supply/update-stock.use-case.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';

export class UpdateStockUseCase implements IUpdateStockUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
  ) {}

  async execute(id: string, input: UpdateStockDto): Promise<PartSupply> {
    const partSupply = await this.unitOfWork.executeTransaction(async (repos) => {
      const partSupply = await repos.partSupply.findById(id);

      if (!partSupply) {
        throw new ResourceNotFoundException('Peça ou Insumo', id);
      }

      partSupply.applyStockMovement(input.type, input.quantity);

      const movement = StockMovement.create({
        partSupplyId: id,
        workOrderId: input.workOrderId ?? null,
        type: input.type,
        quantity: input.quantity,
        reason: input.reason ?? null,
      });

      await Promise.all([
        repos.partSupply.update(partSupply),
        repos.stockMovement.create(movement),
      ]);

      return partSupply;
    });

    this.logger.event(BUSINESS_EVENTS.STOCK_UPDATED, {
      partSupplyId: partSupply.id,
      partSupplyName: partSupply.name,
      movementType: input.type,
      movementQuantity: input.quantity,
      currentQuantity: partSupply.stock,
      workOrderId: input.workOrderId ?? undefined,
    });

    return partSupply;
  }
}
