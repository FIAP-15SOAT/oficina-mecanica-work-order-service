import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign } from 'jsonwebtoken';

import { CustomerJwtStrategy } from '@infrastructure/http/strategies/customer-jwt.strategy';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { AuthFlow } from '@domain/enums/auth-flow.enum';

import {
  CUSTOMER_JWT_TEST_PRIVATE_KEY,
  CUSTOMER_JWT_TEST_PUBLIC_KEY,
  CUSTOMER_JWT_TEST_ISSUER,
  CUSTOMER_JWT_TEST_AUDIENCE,
  signTestCustomerToken,
} from '../../../../helpers/customer-jwt.helper';
import { createMockUserCustomerRepository } from '../../../../helpers/unit-of-work-mock.factory';

const CONFIG: Record<string, string> = {
  CUSTOMER_JWT_PUBLIC_KEY: CUSTOMER_JWT_TEST_PUBLIC_KEY,
  CUSTOMER_JWT_ISSUER: CUSTOMER_JWT_TEST_ISSUER,
  CUSTOMER_JWT_AUDIENCE: CUSTOMER_JWT_TEST_AUDIENCE,
};

type Outcome = { success: unknown } | { fail: unknown } | { error: unknown };

function configWith(values: Record<string, string>): ConfigService {
  return { getOrThrow: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

describe('CustomerJwtStrategy', () => {
  let strategy: CustomerJwtStrategy;
  let userCustomerRepository: jest.Mocked<IUserCustomerRepository>;

  beforeEach(() => {
    userCustomerRepository = createMockUserCustomerRepository();

    strategy = new CustomerJwtStrategy(configWith(CONFIG), userCustomerRepository);
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

  it('should accept a customer with an active link', async () => {
    const userId = randomUUID();
    userCustomerRepository.findActiveCustomerIdsByUserId.mockResolvedValue([randomUUID()]);

    const outcome = await authenticate(signTestCustomerToken(userId));

    expect(outcome).toEqual({ success: { sub: userId, authFlow: AuthFlow.CUSTOMER } });
    expect(userCustomerRepository.findActiveCustomerIdsByUserId).toHaveBeenCalledWith(userId);
  });

  it('should answer 401 when the user has no active linked customer', async () => {
    userCustomerRepository.findActiveCustomerIdsByUserId.mockResolvedValue([]);

    const outcome = await authenticate(signTestCustomerToken(randomUUID()));

    expect(outcome).toEqual({
      error: new UnauthorizedException('Nenhum cliente ativo vinculado'),
    });
  });

  it('should answer 401 to a token signed without exp', async () => {
    const token = sign({ sub: randomUUID() }, CUSTOMER_JWT_TEST_PRIVATE_KEY, {
      algorithm: 'RS256',
      issuer: CUSTOMER_JWT_TEST_ISSUER,
      audience: CUSTOMER_JWT_TEST_AUDIENCE,
    });

    const outcome = await authenticate(token);

    expect(outcome).toEqual({ error: new UnauthorizedException('Token sem expiração') });
    expect(userCustomerRepository.findActiveCustomerIdsByUserId).not.toHaveBeenCalled();
  });

  it.each([
    ['no sub', {}],
    ['an empty sub', { sub: '' }],
    ['a numeric sub', { sub: 42 }],
    ['a sub that is not a UUID', { sub: 'user-123' }],
  ])('should answer 401 to a token with %s without querying the links', async (_case, claims) => {
    const token = sign(claims, CUSTOMER_JWT_TEST_PRIVATE_KEY, {
      algorithm: 'RS256',
      issuer: CUSTOMER_JWT_TEST_ISSUER,
      audience: CUSTOMER_JWT_TEST_AUDIENCE,
      expiresIn: 3600,
    });

    const outcome = await authenticate(token);

    expect(outcome).toEqual({ error: new UnauthorizedException('Token inválido') });
    expect(userCustomerRepository.findActiveCustomerIdsByUserId).not.toHaveBeenCalled();
  });

  it.each([
    [
      'signed with HS256 using the public key bytes as the HMAC secret',
      () =>
        sign({ sub: randomUUID() }, CUSTOMER_JWT_TEST_PUBLIC_KEY, {
          algorithm: 'HS256',
          issuer: CUSTOMER_JWT_TEST_ISSUER,
          audience: CUSTOMER_JWT_TEST_AUDIENCE,
          expiresIn: 3600,
        }),
    ],
    [
      'signed with RS384 using the same RSA key pair',
      () =>
        sign({ sub: randomUUID() }, CUSTOMER_JWT_TEST_PRIVATE_KEY, {
          algorithm: 'RS384',
          issuer: CUSTOMER_JWT_TEST_ISSUER,
          audience: CUSTOMER_JWT_TEST_AUDIENCE,
          expiresIn: 3600,
        }),
    ],
    [
      'with the wrong issuer',
      () =>
        sign({ sub: randomUUID() }, CUSTOMER_JWT_TEST_PRIVATE_KEY, {
          algorithm: 'RS256',
          issuer: 'wrong-issuer',
          audience: CUSTOMER_JWT_TEST_AUDIENCE,
          expiresIn: 3600,
        }),
    ],
    [
      'with the wrong audience',
      () =>
        sign({ sub: randomUUID() }, CUSTOMER_JWT_TEST_PRIVATE_KEY, {
          algorithm: 'RS256',
          issuer: CUSTOMER_JWT_TEST_ISSUER,
          audience: 'wrong-audience',
          expiresIn: 3600,
        }),
    ],
    ['expired', () => signTestCustomerToken(randomUUID(), -10)],
  ])('should fail a token %s', async (_case, token) => {
    const outcome = await authenticate(token());

    expect(outcome).toHaveProperty('fail');
    expect(userCustomerRepository.findActiveCustomerIdsByUserId).not.toHaveBeenCalled();
  });

  it('should accept a valid token when the configured public key has literal \\n escape sequences instead of real newlines', async () => {
    const userId = randomUUID();
    strategy = new CustomerJwtStrategy(
      configWith({
        ...CONFIG,
        CUSTOMER_JWT_PUBLIC_KEY: CUSTOMER_JWT_TEST_PUBLIC_KEY.replaceAll('\n', '\\n'),
      }),
      userCustomerRepository,
    );
    userCustomerRepository.findActiveCustomerIdsByUserId.mockResolvedValue([randomUUID()]);

    const outcome = await authenticate(signTestCustomerToken(userId));

    expect(outcome).toEqual({ success: { sub: userId, authFlow: AuthFlow.CUSTOMER } });
  });

  describe('CUSTOMER_JWT_PUBLIC_KEY format guard', () => {
    it.each([
      ['is not a PEM public key', 'not-a-pem-key'],
      ['is registered but empty', ''],
    ])('should fail fast with a clear message when the secret %s', (_case, publicKey) => {
      expect(
        () =>
          new CustomerJwtStrategy(
            configWith({ ...CONFIG, CUSTOMER_JWT_PUBLIC_KEY: publicKey }),
            userCustomerRepository,
          ),
      ).toThrow('CUSTOMER_JWT_PUBLIC_KEY não é uma chave pública PEM válida');
    });
  });
});
