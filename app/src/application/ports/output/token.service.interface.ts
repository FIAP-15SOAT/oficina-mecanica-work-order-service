import { UserRole } from '@domain/enums/user-role.enum';

export interface TokenPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole | null;
  typ?: 'access' | 'refresh';
  /** Emitido automaticamente na assinatura; usado para invalidar sessões anteriores à troca de senha. */
  iat?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ITokenService {
  signAccessToken(payload: TokenPayload): string;
  signRefreshToken(payload: TokenPayload): string;
  signTokenPair(payload: TokenPayload): TokenPair;
  verifyRefreshToken(token: string): TokenPayload;
}
