import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { AuthFlow } from '@domain/enums/auth-flow.enum';
import { readPemKey } from '@infrastructure/utils/read-pem-key.util';

interface CustomerJwtClaims {
  sub: string;
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
    @Inject('IUserRepository')
    private readonly userRepository: IUserRepository,
    @Inject('IUserCustomerRepository')
    private readonly userCustomerRepository: IUserCustomerRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: readPemKey(configService, 'CUSTOMER_JWT_PUBLIC_KEY', 'PUBLIC'),
      algorithms: ['RS256'],
      issuer: configService.getOrThrow<string>('CUSTOMER_JWT_ISSUER'),
      audience: configService.getOrThrow<string>('CUSTOMER_JWT_AUDIENCE'),
    });
  }

  async validate(payload: CustomerJwtClaims): Promise<AuthenticatedPrincipal> {
    if (typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Token sem expiração');
    }

    const user = await this.userRepository.findById(payload.sub);

    if (!user?.isActive) {
      throw new UnauthorizedException('Usuário inválido ou desativado');
    }

    if (
      typeof payload.iat !== 'number' ||
      payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      throw new UnauthorizedException('Sessão expirada. Autentique-se novamente.');
    }

    const activeCustomerIds = await this.userCustomerRepository.findActiveCustomerIdsByUserId(
      user.id,
    );

    if (activeCustomerIds.length === 0) {
      throw new UnauthorizedException('Nenhum cliente ativo vinculado');
    }

    return { sub: user.id, authFlow: AuthFlow.CUSTOMER, email: user.email.value };
  }
}
