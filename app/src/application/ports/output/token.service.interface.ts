import { UserRole } from '@domain/enums/user-role.enum';

export interface TokenPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole | null;
  typ?: 'access' | 'refresh';
  /** Set automatically on signing; used to invalidate sessions older than a password change. */
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
