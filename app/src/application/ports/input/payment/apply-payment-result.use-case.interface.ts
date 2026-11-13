import { ApplyPaymentResultInputDto } from './dto/apply-payment-result.dto';

export interface IApplyPaymentResultUseCase {
  execute(input: ApplyPaymentResultInputDto): Promise<void>;
}
