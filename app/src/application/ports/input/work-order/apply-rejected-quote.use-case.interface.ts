import { ApplyRejectedQuoteInputDto } from './dto/apply-rejected-quote.dto';

export interface IApplyRejectedQuoteUseCase {
  execute(input: ApplyRejectedQuoteInputDto): Promise<void>;
}
