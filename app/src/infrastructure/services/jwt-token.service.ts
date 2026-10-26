import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ITokenService,
  TokenPair,
  TokenPayload,
} from '@application/ports/output/token.service.interface';
import { readPemKey } from '@infrastructure/utils/read-pem-key.util';
import { STAFF_TOKEN_ALGORITHM } from './staff-token.constants';

type Duration = `${number}${'s' | 'm' | 'h' | 'd'}`;

@Injectable()
export class JwtTokenService implements ITokenService {
  private readonly accessPrivateKey: string;
  private readonly keyId: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly accessExpiresIn: Duration;
  private readonly refreshPrivateKey: string;
  private readonly refreshExpiresIn: Duration;

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.accessPrivateKey = readPemKey(configService, 'STAFF_JWT_PRIVATE_KEY', 'PRIVATE');

    this.keyId = configService.getOrThrow<string>('STAFF_JWT_KEY_ID');

    this.issuer = configService.getOrThrow<string>('STAFF_JWT_ISSUER');

    this.audience = configService.getOrThrow<string>('STAFF_JWT_AUDIENCE');

    this.accessExpiresIn = configService.get<string>('STAFF_JWT_EXPIRATION', '10m') as Duration;

    this.refreshPrivateKey = readPemKey(configService, 'STAFF_JWT_REFRESH_PRIVATE_KEY', 'PRIVATE');

    this.refreshExpiresIn = configService.get<string>(
      'STAFF_JWT_REFRESH_EXPIRATION',
      '7d',
    ) as Duration;
  }

  signAccessToken(payload: TokenPayload): string {
    return this.jwtService.sign(
      { ...payload, typ: 'access' },
      {
        privateKey: this.accessPrivateKey,
        algorithm: STAFF_TOKEN_ALGORITHM,
        keyid: this.keyId,
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: this.accessExpiresIn,
      },
    );
  }

  signRefreshToken(payload: TokenPayload): string {
    return this.jwtService.sign(
      { ...payload, typ: 'refresh' },
      {
        privateKey: this.refreshPrivateKey,
        algorithm: STAFF_TOKEN_ALGORITHM,
        issuer: this.issuer,
        // Only the issuer consumes refresh tokens.
        audience: this.issuer,
        expiresIn: this.refreshExpiresIn,
      },
    );
  }

  signTokenPair(payload: TokenPayload): TokenPair {
    return {
      accessToken: this.signAccessToken(payload),
      refreshToken: this.signRefreshToken(payload),
    };
  }

  verifyRefreshToken(token: string): TokenPayload {
    const payload = this.jwtService.verify<TokenPayload>(token, {
      // jsonwebtoken derives the public key from the private one; only the issuer verifies refresh tokens.
      publicKey: this.refreshPrivateKey,
      algorithms: [STAFF_TOKEN_ALGORITHM],
      issuer: this.issuer,
      audience: this.issuer,
    });

    if (payload.typ !== 'refresh') {
      throw new Error('Token não é de refresh');
    }

    return payload;
  }
}
