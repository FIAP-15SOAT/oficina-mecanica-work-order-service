import { SagaInstance } from '../../entities/saga-instance.entity';
import { SagaType } from '../../enums/saga-type.enum';

export interface ISagaInstanceRepository {
  findByTypeAndCorrelationId(type: SagaType, correlationId: string): Promise<SagaInstance | null>;
  hasActiveByWorkOrderId(workOrderId: string): Promise<boolean>;
  create(saga: SagaInstance): Promise<SagaInstance>;
  update(saga: SagaInstance): Promise<SagaInstance>;
}
