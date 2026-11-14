import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { validate as isUuid } from 'uuid';

import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { AuthFlow } from '@domain/enums/auth-flow.enum';
import { readPemKey } from '@infrastructure/utils/read-pem-key.util';

interface CustomerJwtClaims {
  sub?: unknown;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

/**
 * Passport strategy fully isolated from the staff one: both are RS256, but
 * each has its own public key, issuer and audience, so a staff token never
 * passes here and a customer token never passes the JwtStrategy.
 */
@Injectable()
export class CustomerJwtStrategy extends PassportStrategy(Strategy, 'customer-jwt') {
  constructor(
    configService: ConfigService,
    @Inject('IUserCustomerRepository')
    private readonly userCustomerRepository: IUserCustomerRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: readPemKey(configService, 'CUSTOMER_JWT_PUBLIC_KEY'),
      algorithms: ['RS256'],
      issuer: configService.getOrThrow<string>('CUSTOMER_JWT_ISSUER'),
      audience: configService.getOrThrow<string>('CUSTOMER_JWT_AUDIENCE'),
    });
  }

  async validate(payload: CustomerJwtClaims): Promise<AuthenticatedPrincipal> {
    if (typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Token sem expiração');
    }

    // The link queries would drop an undefined sub from the where and match every user.
    if (typeof payload.sub !== 'string' || !isUuid(payload.sub)) {
      throw new UnauthorizedException('Token inválido');
    }

    const activeCustomerIds = await this.userCustomerRepository.findActiveCustomerIdsByUserId(
      payload.sub,
    );

    if (activeCustomerIds.length === 0) {
      throw new UnauthorizedException('Nenhum cliente ativo vinculado');
    }

    return { sub: payload.sub, authFlow: AuthFlow.CUSTOMER };
  }
}
