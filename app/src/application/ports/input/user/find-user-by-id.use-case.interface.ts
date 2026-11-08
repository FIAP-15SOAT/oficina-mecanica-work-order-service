import { FindUserByIdOutput } from '@application/ports/input/user/dto/find-user-by-id.dto';

export interface IFindUserByIdUseCase {
  execute(id: string): Promise<FindUserByIdOutput>;
}
