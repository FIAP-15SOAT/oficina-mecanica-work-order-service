import { generateKeyPairSync } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { decode, Jwt, JwtPayload, sign, verify } from 'jsonwebtoken';
import { UserRole } from '@domain/enums/user-role.enum';
import { TokenPayload } from '@application/ports/output/services/token.service.interface';
import { JwtTokenService } from '@infrastructure/services/jwt-token.service';
import {
  STAFF_JWT_TEST_AUDIENCE,
  STAFF_JWT_TEST_ISSUER,
  STAFF_JWT_TEST_KEY_ID,
  STAFF_JWT_TEST_PRIVATE_KEY,
  STAFF_REFRESH_TEST_PRIVATE_KEY,
  STAFF_REFRESH_TEST_PUBLIC_KEY,
  signTestStaffToken,
} from '../../../helpers/staff-jwt.helper';

const CONFIG: Record<string, string> = {
  STAFF_JWT_PRIVATE_KEY: STAFF_JWT_TEST_PRIVATE_KEY,
  STAFF_JWT_REFRESH_PRIVATE_KEY: STAFF_REFRESH_TEST_PRIVATE_KEY,
  STAFF_JWT_KEY_ID: STAFF_JWT_TEST_KEY_ID,
  STAFF_JWT_ISSUER: STAFF_JWT_TEST_ISSUER,
  STAFF_JWT_AUDIENCE: STAFF_JWT_TEST_AUDIENCE,
};

function createConfigService(overrides: Record<string, string> = {}): ConfigService {
  const values = { ...CONFIG, ...overrides };
  return {
    getOrThrow: jest.fn((key: string) => values[key]),
    get: jest.fn((key: string, fallback: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

function decodeComplete(token: string): Jwt & { payload: JwtPayload } {
  return decode(token, { complete: true }) as Jwt & { payload: JwtPayload };
}

describe('JwtTokenService', () => {
  let service: JwtTokenService;

  const payload: TokenPayload = {
    sub: 'user-uuid-123',
    email: 'admin@email.com',
    name: 'Admin',
    role: UserRole.ADMIN,
  };

  beforeEach(() => {
    service = new JwtTokenService(new JwtService(), createConfigService());
  });

  describe('signAccessToken', () => {
    it('signs the access token with RS256 and the configured kid', () => {
      const { header } = decodeComplete(service.signAccessToken(payload));

      expect(header.alg).toBe('RS256');
      expect(header.kid).toBe(STAFF_JWT_TEST_KEY_ID);
    });

    it('puts the staff profile claims in the access token', () => {
      const claims = decodeComplete(service.signAccessToken(payload)).payload;

      expect(claims).toMatchObject({
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        typ: 'access',
        iss: 'oficina-identity',
        aud: 'oficina-services',
      });
      expect(claims.exp! - claims.iat!).toBe(600);
    });
  });

  describe('signRefreshToken', () => {
    it('signs the refresh token with its own key, audience and type, without kid', () => {
      const token = service.signRefreshToken(payload);
      const claims = verify(token, STAFF_REFRESH_TEST_PUBLIC_KEY, {
        algorithms: ['RS256'],
      }) as JwtPayload;

      expect(claims).toMatchObject({ aud: 'oficina-identity', typ: 'refresh' });
      expect(claims.exp! - claims.iat!).toBe(604800);
      expect(decodeComplete(token).header.kid).toBeUndefined();
      expect(() =>
        verify(service.signAccessToken(payload), STAFF_REFRESH_TEST_PUBLIC_KEY),
      ).toThrow();
    });
  });

  describe('signTokenPair', () => {
    it('returns both tokens from signTokenPair', () => {
      const pair = service.signTokenPair(payload);

      expect(decodeComplete(pair.accessToken).payload.typ).toBe('access');
      expect(decodeComplete(pair.refreshToken).payload.typ).toBe('refresh');
    });
  });

  it('uses the configured issuer and audience, with the issuer as refresh audience', () => {
    const custom = new JwtTokenService(
      new JwtService(),
      createConfigService({
        STAFF_JWT_ISSUER: 'custom-issuer',
        STAFF_JWT_AUDIENCE: 'custom-audience',
      }),
    );
    const refreshToken = custom.signRefreshToken(payload);

    expect(decodeComplete(custom.signAccessToken(payload)).payload).toMatchObject({
      iss: 'custom-issuer',
      aud: 'custom-audience',
    });
    expect(decodeComplete(refreshToken).payload).toMatchObject({
      iss: 'custom-issuer',
      aud: 'custom-issuer',
    });
    expect(custom.verifyRefreshToken(refreshToken)).toMatchObject({ typ: 'refresh' });
    expect(() => service.verifyRefreshToken(refreshToken)).toThrow();
  });

  describe('verifyRefreshToken', () => {
    it('verifies a refresh token it issued', () => {
      const result = service.verifyRefreshToken(service.signRefreshToken(payload));

      expect(result).toMatchObject({ ...payload, typ: 'refresh' });
    });

    it('rejects an access token as refresh', () => {
      expect(() => service.verifyRefreshToken(service.signAccessToken(payload))).toThrow();
    });

    it('rejects a refresh token signed by another key', () => {
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const forged = signTestStaffToken(
        { ...payload, typ: 'refresh' },
        { audience: 'oficina-identity' },
        privateKey,
      );

      expect(() => service.verifyRefreshToken(forged)).toThrow();
    });

    it('rejects a token signed with the refresh key whose typ is not refresh', () => {
      const forged = sign({ ...payload, typ: 'access' }, STAFF_REFRESH_TEST_PRIVATE_KEY, {
        algorithm: 'RS256',
        issuer: 'oficina-identity',
        audience: 'oficina-identity',
        expiresIn: '7d',
      });

      expect(() => service.verifyRefreshToken(forged)).toThrow('Token não é de refresh');
    });
  });

  it('fails to start when STAFF_JWT_PRIVATE_KEY is not PEM', () => {
    expect(
      () =>
        new JwtTokenService(
          new JwtService(),
          createConfigService({ STAFF_JWT_PRIVATE_KEY: 'not-a-key' }),
        ),
    ).toThrow('STAFF_JWT_PRIVATE_KEY não é uma chave privada PEM válida');
  });
});
