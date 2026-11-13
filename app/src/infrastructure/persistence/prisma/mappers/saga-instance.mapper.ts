import type { SagaInstance as PrismaSagaInstance } from '@generated/client';
import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { PaymentOriginStatus } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';

export class SagaInstanceMapper {
  static toDomain(record: PrismaSagaInstance): SagaInstance {
    return SagaInstance.reconstitute({
      id: record.id,
      type: record.type as SagaType,
      correlationId: record.correlationId,
      workOrderId: record.workOrderId,
      status: record.status as SagaStatus,
      failureReason: record.failureReason as SagaFailureReason | null,
      originStatus: record.originStatus as PaymentOriginStatus | null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
