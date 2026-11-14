import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { JwtHeader } from 'jsonwebtoken';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { validate as isUuid } from 'uuid';

import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { AuthFlow } from '@domain/enums/auth-flow.enum';
import { UserRole } from '@domain/enums/user-role.enum';
import { readPemKey } from '@infrastructure/utils/read-pem-key.util';
import { STAFF_TOKEN_ALGORITHM } from '@infrastructure/services/staff-token.constants';

interface StaffTokenPayload {
  sub?: unknown;
  email?: unknown;
  role?: unknown;
  typ?: unknown;
  exp?: unknown;
}

interface StaffJwt {
  header: JwtHeader;
  payload: StaffTokenPayload;
}

const USER_ROLES: readonly unknown[] = Object.values(UserRole);

// The token is trusted on its own signature: the user is not read here nor in the Identity.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly keyId: string;

  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: readPemKey(configService, 'STAFF_JWT_PUBLIC_KEY'),
      algorithms: [STAFF_TOKEN_ALGORITHM],
      issuer: configService.getOrThrow<string>('STAFF_JWT_ISSUER'),
      audience: configService.getOrThrow<string>('STAFF_JWT_AUDIENCE'),
      // validate() needs the header to check the kid.
      jsonWebTokenOptions: { complete: true },
    });
    this.keyId = configService.getOrThrow<string>('STAFF_JWT_KEY_ID');
  }

  validate({ header, payload }: StaffJwt): AuthenticatedPrincipal {
    // jsonwebtoken only checks exp when the claim exists.
    if (
      header.kid !== this.keyId ||
      payload.typ !== 'access' ||
      typeof payload.exp !== 'number' ||
      typeof payload.sub !== 'string' ||
      !isUuid(payload.sub) ||
      typeof payload.email !== 'string' ||
      !USER_ROLES.includes(payload.role)
    ) {
      throw new UnauthorizedException('Token inválido');
    }

    return {
      sub: payload.sub,
      authFlow: AuthFlow.INTERNAL,
      email: payload.email,
      role: payload.role as UserRole,
    };
  }
}
