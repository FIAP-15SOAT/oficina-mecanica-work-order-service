import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';
import {
  createMockHashService,
  createMockTokenService,
  createMockUser,
  createMockUserRepository,
} from '../../../../helpers/mock-factories';
import { AuthenticateUserUseCase } from '@application/use-cases/auth/authenticate-user.use-case';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';

describe('AuthenticateUserUseCase', () => {
  let useCase: AuthenticateUserUseCase;
  let logger: jest.Mocked<ILogger>;
  let userRepository: ReturnType<typeof createMockUserRepository>;
  let hashService: ReturnType<typeof createMockHashService>;
  let tokenService: ReturnType<typeof createMockTokenService>;

  beforeEach(() => {
    userRepository = createMockUserRepository();
    hashService = createMockHashService();
    tokenService = createMockTokenService();
    logger = createMockLogger();
    useCase = new AuthenticateUserUseCase(userRepository, hashService, tokenService, logger);
  });

  it('should authenticate user successfully and return tokens', async () => {
    const user = createMockUser();
    userRepository.findByEmail.mockResolvedValue(user);
    hashService.compare.mockResolvedValue(true);

    const result = await useCase.execute({
      email: 'admin@email.com',
      password: 'Senha@123',
    });

    expect(result.accessToken).toBe('access-token-mock');
    expect(result.refreshToken).toBe('refresh-token-mock');
    expect(result.user.id).toBe(user.id);
    expect(result.user.email).toBe(user.email.value);
    expect(tokenService.signTokenPair).toHaveBeenCalledWith({
      sub: user.id,
      email: user.email.value,
      name: user.name,
      role: user.role,
    });
  });

  it('should throw UnauthorizedAccessException if user does not exist', async () => {
    userRepository.findByEmail.mockResolvedValue(null);

    await expect(
      useCase.execute({ email: 'naoexiste@email.com', password: '123456' }),
    ).rejects.toThrow(UnauthorizedAccessException);
  });

  it('should throw UnauthorizedAccessException if user is deactivated', async () => {
    const user = createMockUser({ isActive: false });
    userRepository.findByEmail.mockResolvedValue(user);

    await expect(
      useCase.execute({ email: 'admin@email.com', password: 'Senha@123' }),
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('should throw UnauthorizedAccessException if password is incorrect', async () => {
    const user = createMockUser();
    userRepository.findByEmail.mockResolvedValue(user);
    hashService.compare.mockResolvedValue(false);

    await expect(useCase.execute({ email: 'admin@email.com', password: 'errada' })).rejects.toThrow(
      'Credenciais inválidas',
    );
  });

  it('should reject an externally-only account (role null) with the same generic message', async () => {
    const user = createMockUser({ role: null });
    userRepository.findByEmail.mockResolvedValue(user);
    hashService.compare.mockResolvedValue(true);

    await expect(
      useCase.execute({ email: 'externo@email.com', password: 'Senha@123' }),
    ).rejects.toThrow('Credenciais inválidas');

    expect(tokenService.signTokenPair).not.toHaveBeenCalled();
    expect(logger.event).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ failureReason: 'no_internal_role' }),
    );
  });

  it('não deve gerar tokens se autenticação falhar', async () => {
    userRepository.findByEmail.mockResolvedValue(null);

    await expect(
      useCase.execute({ email: 'admin@email.com', password: '123456' }),
    ).rejects.toThrow();

    expect(tokenService.signTokenPair).not.toHaveBeenCalled();
  });

  it('should report a distinct cause for each failure while throwing an identical message', async () => {
    userRepository.findByEmail.mockResolvedValueOnce(null);
    await expect(useCase.execute({ email: 'a@b.com', password: 'x' })).rejects.toThrow(
      'Credenciais inválidas',
    );

    userRepository.findByEmail.mockResolvedValueOnce(createMockUser({ isActive: false }));
    await expect(useCase.execute({ email: 'a@b.com', password: 'x' })).rejects.toThrow(
      'Credenciais inválidas',
    );

    userRepository.findByEmail.mockResolvedValueOnce(createMockUser());
    hashService.compare.mockResolvedValueOnce(false);
    await expect(useCase.execute({ email: 'a@b.com', password: 'x' })).rejects.toThrow(
      'Credenciais inválidas',
    );

    userRepository.findByEmail.mockResolvedValueOnce(createMockUser({ role: null }));
    hashService.compare.mockResolvedValueOnce(true);
    await expect(useCase.execute({ email: 'a@b.com', password: 'x' })).rejects.toThrow(
      'Credenciais inválidas',
    );

    expect(logger.event.mock.calls.map((call) => call[1])).toEqual([
      { failureReason: 'unknown_user' },
      {
        failureReason: 'inactive_user',
        subjectId: 'user-uuid-123',
        subjectName: 'Admin User',
        subjectEmail: 'admin@email.com',
      },
      {
        failureReason: 'wrong_password',
        subjectId: 'user-uuid-123',
        subjectName: 'Admin User',
        subjectEmail: 'admin@email.com',
      },
      {
        failureReason: 'no_internal_role',
        subjectId: 'user-uuid-123',
        subjectName: 'Admin User',
        subjectEmail: 'admin@email.com',
      },
    ]);
  });

  it('should emit the success event with the authenticated subject', async () => {
    userRepository.findByEmail.mockResolvedValue(createMockUser());
    hashService.compare.mockResolvedValue(true);

    await useCase.execute({ email: 'a@b.com', password: 'x' });

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event.mock.calls[0][1]).toEqual({
      subjectId: 'user-uuid-123',
      subjectName: 'Admin User',
      subjectEmail: 'admin@email.com',
    });
  });

  it('should never emit the password in the event fields', async () => {
    userRepository.findByEmail.mockResolvedValue(createMockUser());
    hashService.compare.mockResolvedValue(false);

    await expect(
      useCase.execute({ email: 'admin@email.com', password: 'Tech@2026' }),
    ).rejects.toThrow(UnauthorizedAccessException);

    expect(JSON.stringify(logger.event.mock.calls)).not.toContain('Tech@2026');
  });

  it('should declare the subject identity under fields the registry masks', async () => {
    userRepository.findByEmail.mockResolvedValue(createMockUser());
    hashService.compare.mockResolvedValue(false);

    await expect(
      useCase.execute({ email: 'admin@email.com', password: 'Tech@2026' }),
    ).rejects.toThrow(UnauthorizedAccessException);

    expect(logger.event.mock.calls[0][1]).toMatchObject({
      subjectName: 'Admin User',
      subjectEmail: 'admin@email.com',
    });
  });
});
