import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { UpdateUserStatusUseCase } from '@application/use-cases/user/update-user-status.use-case';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { createMockUser, createMockUserRepository } from '../../../../helpers/user-mock.factory';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';

describe('UpdateUserStatusUseCase', () => {
  let useCase: UpdateUserStatusUseCase;
  let logger: jest.Mocked<ILogger>;
  let userRepository: jest.Mocked<IUserRepository>;

  beforeEach(() => {
    userRepository = createMockUserRepository();
    logger = createMockLogger();
    useCase = new UpdateUserStatusUseCase(userRepository, logger);
  });

  it('should activate an inactive user', async () => {
    const user = createMockUser({ isActive: false });

    const activated = createMockUser({
      ...user,
      isActive: true,
    });

    userRepository.findById.mockResolvedValue(user);
    userRepository.update.mockResolvedValue(activated);

    const result = await useCase.execute(user.id, true);

    expect(result).toEqual(activated.toPublicView());
    expect(userRepository.update).toHaveBeenCalledWith(user);
  });

  it('should deactivate an active user', async () => {
    const user = createMockUser({ isActive: true });

    const deactivated = createMockUser({
      ...user,
      isActive: false,
    });

    userRepository.findById.mockResolvedValue(user);
    userRepository.update.mockResolvedValue(deactivated);

    const result = await useCase.execute(user.id, false);

    expect(result).toEqual(deactivated.toPublicView());
    expect(userRepository.update).toHaveBeenCalledWith(user);
  });

  it('should throw ResourceNotFoundException when user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute('non-existent-id', true)).rejects.toThrow(
      ResourceNotFoundException,
    );

    expect(userRepository.update).not.toHaveBeenCalled();
  });
});
