import { JwtAuthGuard } from '@infrastructure/http/guards/jwt-auth.guard';
import { AuthenticationFailedException } from '@infrastructure/exceptions/authentication-failed.exception';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  describe('handleRequest', () => {
    it('should return user when no error and user is provided', () => {
      const user = { sub: 'user-id', email: 'user@example.com' };

      const result = guard.handleRequest(null, user);

      expect(result).toBe(user);
    });

    it('should throw AuthenticationFailedException when err is provided', () => {
      const error = new Error('Token expired');

      expect(() => {
        guard.handleRequest(error, null);
      }).toThrow(AuthenticationFailedException);
      expect(() => {
        guard.handleRequest(error, null);
      }).toThrow('Token de autenticação inválido ou ausente.');
    });

    it('should throw AuthenticationFailedException when user is null', () => {
      expect(() => {
        guard.handleRequest(null, null);
      }).toThrow(AuthenticationFailedException);
    });

    it('should throw AuthenticationFailedException when user is undefined', () => {
      expect(() => {
        guard.handleRequest(null, undefined);
      }).toThrow(AuthenticationFailedException);
    });

    it('should throw AuthenticationFailedException when user is false', () => {
      expect(() => {
        guard.handleRequest(null, false);
      }).toThrow(AuthenticationFailedException);
    });

    it('should throw AuthenticationFailedException when both err and user are present', () => {
      const error = new Error('Some error');
      const user = { sub: 'user-id' };

      expect(() => {
        guard.handleRequest(error, user);
      }).toThrow(AuthenticationFailedException);
    });
  });
});
