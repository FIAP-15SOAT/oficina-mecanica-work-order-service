import { ApplySentQuoteInputDto } from './dto/apply-sent-quote.dto';

export interface IApplySentQuoteUseCase {
  execute(input: ApplySentQuoteInputDto): Promise<void>;
}
