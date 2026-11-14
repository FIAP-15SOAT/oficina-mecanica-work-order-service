import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { sign } from 'jsonwebtoken';

import { JwtStrategy } from '@infrastructure/http/strategies/jwt.strategy';

import { UserRole } from '@domain/enums/user-role.enum';
import { AuthFlow } from '@domain/enums/auth-flow.enum';
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

const CLAIMS = { sub: randomUUID(), email: 'john@example.com', role: UserRole.ADMIN };

const INVALID_TOKEN = { error: new UnauthorizedException('Token inválido') };

type Outcome = { success: unknown } | { fail: unknown } | { error: unknown };

const otherPrivateKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn((key: string) => CONFIG[key]),
    } as unknown as jest.Mocked<ConfigService>;

    strategy = new JwtStrategy(configService);
  });

  /** Runs the full passport-jwt flow: signature, alg, iss, aud and exp, then validate(). */
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

  it('should build the principal from the claims without reading any user', async () => {
    const outcome = await authenticate(signTestStaffToken({ ...CLAIMS, role: UserRole.MECHANIC }));

    expect(outcome).toEqual({
      success: {
        sub: CLAIMS.sub,
        authFlow: AuthFlow.INTERNAL,
        email: CLAIMS.email,
        role: UserRole.MECHANIC,
      },
    });
  });

  describe('with a custom issuer and audience', () => {
    beforeEach(() => {
      const custom: Record<string, string> = {
        ...CONFIG,
        STAFF_JWT_ISSUER: 'custom-issuer',
        STAFF_JWT_AUDIENCE: 'custom-audience',
      };

      strategy = new JwtStrategy({
        getOrThrow: jest.fn((key: string) => custom[key]),
      } as unknown as ConfigService);
    });

    it('should authenticate a token with the configured issuer and audience', async () => {
      const token = signTestStaffToken(CLAIMS, {
        issuer: 'custom-issuer',
        audience: 'custom-audience',
      });

      const outcome = await authenticate(token);

      expect(outcome).toHaveProperty('success');
    });

    it('should fail a token with the default issuer and audience', async () => {
      const outcome = await authenticate(signTestStaffToken(CLAIMS));

      expect(outcome).toHaveProperty('fail');
    });
  });

  it.each([
    ['HS256', () => sign({ ...CLAIMS, typ: 'access' }, 'secret', { algorithm: 'HS256' })],
    [
      'unsigned (alg none)',
      () => sign({ ...CLAIMS, typ: 'access' }, null as never, { algorithm: 'none' }),
    ],
    ['signed by another RS256 key', () => signTestStaffToken(CLAIMS, {}, otherPrivateKey)],
    ['with another issuer', () => signTestStaffToken(CLAIMS, { issuer: 'other' })],
    ['with another audience', () => signTestStaffToken(CLAIMS, { audience: 'oficina-api' })],
    ['refresh sent as access', () => signTestRefreshToken(CLAIMS)],
    ['expired', () => signTestStaffToken(CLAIMS, { expiresIn: -10 })],
  ])('should fail a token %s', async (_case, token) => {
    await expect(authenticate(token())).resolves.toHaveProperty('fail');
  });

  it.each([
    ['a different kid', () => signTestStaffToken(CLAIMS, { keyid: 'other-kid' })],
    [
      'no kid',
      () =>
        sign({ ...CLAIMS, typ: 'access' }, STAFF_JWT_TEST_PRIVATE_KEY, {
          algorithm: 'RS256',
          issuer: STAFF_JWT_TEST_ISSUER,
          audience: STAFF_JWT_TEST_AUDIENCE,
          expiresIn: 600,
        }),
    ],
    ['typ refresh', () => signTestStaffToken({ ...CLAIMS, typ: 'refresh' })],
    [
      'no exp',
      () =>
        sign({ ...CLAIMS, typ: 'access' }, STAFF_JWT_TEST_PRIVATE_KEY, {
          algorithm: 'RS256',
          keyid: STAFF_JWT_TEST_KEY_ID,
          issuer: STAFF_JWT_TEST_ISSUER,
          audience: STAFF_JWT_TEST_AUDIENCE,
        }),
    ],
    ['a role outside UserRole', () => signTestStaffToken({ ...CLAIMS, role: 'CUSTOMER' })],
    ['no role', () => signTestStaffToken({ sub: CLAIMS.sub, email: CLAIMS.email })],
    ['no sub', () => signTestStaffToken({ email: CLAIMS.email, role: CLAIMS.role })],
    ['an empty sub', () => signTestStaffToken({ ...CLAIMS, sub: '' })],
    ['a numeric sub', () => signTestStaffToken({ ...CLAIMS, sub: 42 })],
    ['a sub that is not a UUID', () => signTestStaffToken({ ...CLAIMS, sub: 'user-uuid-123' })],
    ['a non-string email', () => signTestStaffToken({ ...CLAIMS, email: 42 })],
  ])('should answer 401 to a token with %s', async (_case, token) => {
    await expect(authenticate(token())).resolves.toEqual(INVALID_TOKEN);
  });
});
