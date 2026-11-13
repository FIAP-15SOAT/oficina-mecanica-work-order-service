import { StartPaymentInputDto } from './dto/start-payment.dto';

export interface IStartPaymentUseCase {
  execute(input: StartPaymentInputDto): Promise<void>;
}
