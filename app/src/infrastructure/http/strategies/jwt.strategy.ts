import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { JwtHeader } from 'jsonwebtoken';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { TokenPayload } from '@application/ports/output/token.service.interface';
import { AuthenticatedPrincipal } from '@application/ports/output/authenticated-principal';
import { AuthFlow } from '@domain/enums/auth-flow.enum';
import { readPemKey } from '@infrastructure/utils/read-pem-key.util';
import { STAFF_TOKEN_ALGORITHM } from '@infrastructure/services/staff-token.constants';

interface StaffJwt {
  header: JwtHeader;
  payload: TokenPayload & { exp?: number };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly keyId: string;

  constructor(
    configService: ConfigService,
    @Inject('IUserRepository')
    private readonly userRepository: IUserRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: readPemKey(configService, 'STAFF_JWT_PUBLIC_KEY', 'PUBLIC'),
      algorithms: [STAFF_TOKEN_ALGORITHM],
      issuer: configService.getOrThrow<string>('STAFF_JWT_ISSUER'),
      audience: configService.getOrThrow<string>('STAFF_JWT_AUDIENCE'),
      // validate() needs the header to check the kid.
      jsonWebTokenOptions: { complete: true },
    });
    this.keyId = configService.getOrThrow<string>('STAFF_JWT_KEY_ID');
  }

  async validate({ header, payload }: StaffJwt): Promise<AuthenticatedPrincipal> {
    // jsonwebtoken only checks exp when the claim exists.
    if (header.kid !== this.keyId || payload.typ !== 'access' || typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Token inválido');
    }

    const user = await this.userRepository.findById(payload.sub);

    if (!user?.isActive || !user.role) {
      throw new UnauthorizedException('Usuário inválido ou desativado');
    }

    if (
      typeof payload.iat !== 'number' ||
      payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      throw new UnauthorizedException('Sessão expirada. Autentique-se novamente.');
    }

    return { sub: user.id, authFlow: AuthFlow.INTERNAL, email: user.email.value, role: user.role };
  }
}
