import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { JwtHeader, sign } from 'jsonwebtoken';

import { JwtStrategy } from '@infrastructure/http/strategies/jwt.strategy';

import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { UserRole } from '@domain/enums/user-role.enum';
import { User } from '@domain/entities/user.entity';

import { TokenPayload } from '@application/ports/output/token.service.interface';
import { AuthFlow } from '@domain/enums/auth-flow.enum';
import { createMockUser, createMockUserRepository } from '../../../../helpers/user-mock.factory';
import { Email } from '@domain/value-objects/email.vo';
import {
  STAFF_JWT_TEST_AUDIENCE,
  STAFF_JWT_TEST_ISSUER,
  STAFF_JWT_TEST_KEY_ID,
  STAFF_JWT_TEST_PRIVATE_KEY,
  STAFF_JWT_TEST_PUBLIC_KEY,
  signTestRefreshToken,
  signTestStaffToken,
} from '../../../../helpers/staff-jwt.helper';

const CONFIG: Record<string, string> = {
  STAFF_JWT_PUBLIC_KEY: STAFF_JWT_TEST_PUBLIC_KEY,
  STAFF_JWT_KEY_ID: STAFF_JWT_TEST_KEY_ID,
  STAFF_JWT_ISSUER: STAFF_JWT_TEST_ISSUER,
  STAFF_JWT_AUDIENCE: STAFF_JWT_TEST_AUDIENCE,
};

function asStaffJwt(
  payload: TokenPayload,
  header: JwtHeader = { alg: 'RS256', kid: STAFF_JWT_TEST_KEY_ID },
) {
  return {
    header,
    payload: { typ: 'access' as const, exp: Math.floor(Date.now() / 1000) + 600, ...payload },
  };
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let userRepository: jest.Mocked<IUserRepository>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn((key: string) => CONFIG[key]),
    } as unknown as jest.Mocked<ConfigService>;

    userRepository = createMockUserRepository();

    strategy = new JwtStrategy(configService, userRepository);
  });

  it('should validate and return token payload for active user', async () => {
    const mockUser = createMockUser({
      id: 'user-uuid-123',
      email: Email.create('john@example.com'),
      role: UserRole.ADMIN,
      isActive: true,
    });

    userRepository.findById.mockResolvedValue(mockUser);

    const payload: TokenPayload = {
      name: 'Test User',
      sub: mockUser.id,
      email: mockUser.email.value,
      role: mockUser.role,
      iat: Math.floor(Date.now() / 1000),
    };

    const result = await strategy.validate(asStaffJwt(payload));

    expect(result).toEqual({
      sub: mockUser.id,
      authFlow: AuthFlow.INTERNAL,
      email: mockUser.email.value,
      role: mockUser.role,
    });
    expect(userRepository.findById).toHaveBeenCalledWith(mockUser.id);
  });

  it('should tag the returned principal with authFlow INTERNAL', async () => {
    const user = User.create({
      name: 'Ana',
      email: 'ana@example.com',
      passwordHash: 'hash',
      role: UserRole.ADMIN,
    });
    userRepository.findById.mockResolvedValue(user);

    const result = await strategy.validate(
      asStaffJwt({
        sub: user.id,
        email: user.email.value,
        name: user.name,
        role: user.role!,
        iat: Math.ceil(Date.now() / 1000) + 1,
      }),
    );

    expect(result).toEqual({
      sub: user.id,
      authFlow: AuthFlow.INTERNAL,
      email: user.email.value,
      role: UserRole.ADMIN,
    });
  });

  it('should throw UnauthorizedException when user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    const payload: TokenPayload = {
      name: 'Test User',
      sub: 'non-existent-user',
      email: 'nonexistent@example.com',
      role: UserRole.MECHANIC,
    };

    await expect(strategy.validate(asStaffJwt(payload))).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(asStaffJwt(payload))).rejects.toThrow(
      'Usuário inválido ou desativado',
    );
  });

  it('should throw UnauthorizedException when user is inactive', async () => {
    const mockUser = createMockUser({
      id: 'user-uuid-456',
      email: Email.create('jane@example.com'),
      role: UserRole.ATTENDANT,
      isActive: false,
    });

    userRepository.findById.mockResolvedValue(mockUser);

    const payload: TokenPayload = {
      name: 'Test User',
      sub: mockUser.id,
      email: mockUser.email.value,
      role: mockUser.role,
    };

    await expect(strategy.validate(asStaffJwt(payload))).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(asStaffJwt(payload))).rejects.toThrow(
      'Usuário inválido ou desativado',
    );
  });

  it('should throw UnauthorizedException when the user has no internal role (external-only account)', async () => {
    const mockUser = createMockUser({
      id: 'user-uuid-external',
      email: Email.create('external@example.com'),
      role: null,
      isActive: true,
    });

    userRepository.findById.mockResolvedValue(mockUser);

    const payload: TokenPayload = {
      name: 'Test User',
      sub: mockUser.id,
      email: mockUser.email.value,
      role: null,
    };

    await expect(strategy.validate(asStaffJwt(payload))).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(asStaffJwt(payload))).rejects.toThrow(
      'Usuário inválido ou desativado',
    );
  });

  it('should reject a token issued before the last password change', async () => {
    const passwordChangedAt = new Date();
    const mockUser = createMockUser({
      id: 'user-uuid-password-changed',
      email: Email.create('changed@example.com'),
      role: UserRole.ADMIN,
      isActive: true,
      passwordChangedAt,
    });

    userRepository.findById.mockResolvedValue(mockUser);

    const payload: TokenPayload = {
      name: 'Test User',
      sub: mockUser.id,
      email: mockUser.email.value,
      role: mockUser.role,
      iat: Math.floor((passwordChangedAt.getTime() - 60_000) / 1000),
    };

    await expect(strategy.validate(asStaffJwt(payload))).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(asStaffJwt(payload))).rejects.toThrow(
      'Sessão expirada. Autentique-se novamente.',
    );
  });

  it('should accept a token issued after the last password change', async () => {
    const passwordChangedAt = new Date();
    const mockUser = createMockUser({
      id: 'user-uuid-password-changed-ok',
      email: Email.create('changed-ok@example.com'),
      role: UserRole.ADMIN,
      isActive: true,
      passwordChangedAt,
    });

    userRepository.findById.mockResolvedValue(mockUser);

    const payload: TokenPayload = {
      name: 'Test User',
      sub: mockUser.id,
      email: mockUser.email.value,
      role: mockUser.role,
      iat: Math.ceil((passwordChangedAt.getTime() + 60_000) / 1000),
    };

    const result = await strategy.validate(asStaffJwt(payload));

    expect(result.sub).toBe(mockUser.id);
  });

  it('should reject a token with no iat claim', async () => {
    const mockUser = createMockUser({
      id: 'user-uuid-no-iat',
      email: Email.create('no-iat@example.com'),
      role: UserRole.ADMIN,
      isActive: true,
    });

    userRepository.findById.mockResolvedValue(mockUser);

    const payload: TokenPayload = {
      name: 'Test User',
      sub: mockUser.id,
      email: mockUser.email.value,
      role: mockUser.role,
    };

    await expect(strategy.validate(asStaffJwt(payload))).rejects.toThrow(UnauthorizedException);
  });

  it('should return payload with user data from database', async () => {
    const mockUser = createMockUser({
      id: 'user-uuid-789',
      email: Email.create('bob@example.com'),
      role: UserRole.MECHANIC,
      isActive: true,
    });

    userRepository.findById.mockResolvedValue(mockUser);

    const payload: TokenPayload = {
      name: 'Test User',
      sub: mockUser.id,
      email: 'old@example.com', // Different email in token
      role: UserRole.ADMIN, // Different role in token
      iat: Math.floor(Date.now() / 1000),
    };

    const result = await strategy.validate(asStaffJwt(payload));

    // Should return data from database, not from token
    expect(result.authFlow).toBe(AuthFlow.INTERNAL);
    expect(result.email).toBe(mockUser.email.value);
    if (result.authFlow === AuthFlow.INTERNAL) {
      expect(result.role).toBe(mockUser.role);
    }
    expect(result.sub).toBe(mockUser.id);
  });

  describe('token header and type', () => {
    const payload: TokenPayload = {
      sub: 'user-uuid-123',
      email: 'john@example.com',
      name: 'John',
      role: UserRole.ADMIN,
      iat: Math.floor(Date.now() / 1000),
    };

    it('rejects a token whose kid differs from the configured one', async () => {
      await expect(
        strategy.validate(asStaffJwt(payload, { alg: 'RS256', kid: 'other-kid' })),
      ).rejects.toThrow(new UnauthorizedException('Token inválido'));
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('rejects a token without kid', async () => {
      await expect(strategy.validate(asStaffJwt(payload, { alg: 'RS256' }))).rejects.toThrow(
        new UnauthorizedException('Token inválido'),
      );
    });

    it('rejects a token whose typ is not access', async () => {
      await expect(strategy.validate(asStaffJwt({ ...payload, typ: 'refresh' }))).rejects.toThrow(
        new UnauthorizedException('Token inválido'),
      );
    });
  });

  describe('authenticate', () => {
    type Outcome = { success: unknown } | { fail: unknown } | { error: unknown };

    const claims = { sub: 'user-uuid-123', email: 'john@example.com', name: 'John', role: 'ADMIN' };

    function authenticate(token: string): Promise<Outcome> {
      return new Promise((resolve) => {
        Object.assign(strategy, {
          success: (user: unknown) => resolve({ success: user }),
          fail: (info: unknown) => resolve({ fail: info }),
          error: (error: unknown) => resolve({ error }),
        });
        strategy.authenticate({ headers: { authorization: `Bearer ${token}` } } as never);
      });
    }

    beforeEach(() => {
      userRepository.findById.mockResolvedValue(
        createMockUser({
          id: claims.sub,
          email: Email.create(claims.email),
          role: UserRole.ADMIN,
          isActive: true,
          passwordChangedAt: new Date(Date.now() - 60_000),
        }),
      );
    });

    it('authenticates a valid access token', async () => {
      await expect(authenticate(signTestStaffToken(claims))).resolves.toEqual({
        success: {
          sub: claims.sub,
          authFlow: AuthFlow.INTERNAL,
          email: claims.email,
          role: UserRole.ADMIN,
        },
      });
    });

    it('authenticates with the configured issuer and audience', async () => {
      const custom: Record<string, string> = {
        ...CONFIG,
        STAFF_JWT_ISSUER: 'custom-issuer',
        STAFF_JWT_AUDIENCE: 'custom-audience',
      };
      strategy = new JwtStrategy(
        { getOrThrow: jest.fn((key: string) => custom[key]) } as unknown as ConfigService,
        userRepository,
      );
      const token = signTestStaffToken(claims, {
        issuer: 'custom-issuer',
        audience: 'custom-audience',
      });

      await expect(authenticate(token)).resolves.toHaveProperty('success');
      await expect(authenticate(signTestStaffToken(claims))).resolves.toHaveProperty('fail');
    });

    const otherKey = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;

    it.each([
      ['HS256', () => sign({ ...claims, typ: 'access' }, 'secret', { algorithm: 'HS256' })],
      [
        'unsigned (alg none)',
        () => sign({ ...claims, typ: 'access' }, null as never, { algorithm: 'none' }),
      ],
      ['signed by another RS256 key', () => signTestStaffToken(claims, {}, otherKey)],
      ['with another issuer', () => signTestStaffToken(claims, { issuer: 'other' })],
      ['with another audience', () => signTestStaffToken(claims, { audience: 'oficina-api' })],
      ['refresh sent as access', () => signTestRefreshToken(claims)],
      ['expired', () => signTestStaffToken(claims, { expiresIn: -10 })],
    ])('fails a token %s', async (_case, token) => {
      await expect(authenticate(token())).resolves.toHaveProperty('fail');
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('errors with 401 a token without exp', async () => {
      const token = sign({ ...claims, typ: 'access' }, STAFF_JWT_TEST_PRIVATE_KEY, {
        algorithm: 'RS256',
        keyid: STAFF_JWT_TEST_KEY_ID,
        issuer: 'oficina-identity',
        audience: 'oficina-services',
      });

      await expect(authenticate(token)).resolves.toEqual({
        error: new UnauthorizedException('Token inválido'),
      });
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('errors with 401 a token whose kid differs from the configured one', async () => {
      const outcome = await authenticate(signTestStaffToken(claims, { keyid: 'other-kid' }));

      expect(outcome).toEqual({ error: new UnauthorizedException('Token inválido') });
    });
  });
});
