import { StartQuoteApprovalInputDto } from './dto/start-quote-approval.dto';

export interface IStartQuoteApprovalUseCase {
  execute(input: StartQuoteApprovalInputDto): Promise<void>;
}
