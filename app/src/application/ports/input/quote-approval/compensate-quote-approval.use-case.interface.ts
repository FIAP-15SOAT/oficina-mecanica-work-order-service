import { CompensateQuoteApprovalInputDto } from './dto/compensate-quote-approval.dto';

export interface ICompensateQuoteApprovalUseCase {
  execute(input: CompensateQuoteApprovalInputDto): Promise<void>;
}
