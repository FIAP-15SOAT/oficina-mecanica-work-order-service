import { User } from '@domain/entities/user.entity';
import { UserRole } from '@domain/enums/user-role.enum';
import { IHashService } from '@application/ports/output/services/hash.service.interface';
import {
  ITokenService,
  TokenPair,
} from '@application/ports/output/services/token.service.interface';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { Email } from '@domain/value-objects/email.vo';

export function createMockUser(overrides: Partial<User> = {}): User {
  const now = new Date();

  return User.reconstitute({
    id: 'user-uuid-123',
    name: 'Admin User',
    email: Email.create('admin@email.com'),
    passwordHash: '$2b$12$hashedpassword',
    role: UserRole.ADMIN,
    cpf: null,
    isActive: true,
    passwordChangedAt: new Date(0),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

export function createMockUserRepository(): jest.Mocked<IUserRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findByCpf: jest.fn(),
    findAllPaginated: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

export function createMockHashService(): jest.Mocked<IHashService> {
  return {
    hash: jest.fn().mockResolvedValue('$2b$12$hashed'),
    compare: jest.fn().mockResolvedValue(true),
  };
}

export function createMockTokenService(): jest.Mocked<ITokenService> {
  const pair: TokenPair = {
    accessToken: 'access-token-mock',
    refreshToken: 'refresh-token-mock',
  };

  return {
    signAccessToken: jest.fn().mockReturnValue('access-token-mock'),
    signRefreshToken: jest.fn().mockReturnValue('refresh-token-mock'),
    signTokenPair: jest.fn().mockReturnValue(pair),
    verifyRefreshToken: jest.fn().mockReturnValue({
      sub: 'user-uuid-123',
      email: 'admin@email.com',
      role: UserRole.ADMIN,
      iat: Math.floor(Date.now() / 1000),
    }),
  };
}

export { createMockLogger } from './logger-mock.factory';
