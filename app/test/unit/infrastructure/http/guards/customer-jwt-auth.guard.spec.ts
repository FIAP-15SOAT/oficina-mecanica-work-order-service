import { CustomerJwtAuthGuard } from '@infrastructure/http/guards/customer-jwt-auth.guard';
import { AuthenticationFailedException } from '@infrastructure/exceptions/authentication-failed.exception';

describe('CustomerJwtAuthGuard', () => {
  let guard: CustomerJwtAuthGuard;

  beforeEach(() => {
    guard = new CustomerJwtAuthGuard();
  });

  describe('handleRequest', () => {
    it('should return the principal when the customer strategy resolved one', () => {
      const principal = { sub: 'user-id', authFlow: 'CUSTOMER' };

      const result = guard.handleRequest(null, principal);

      expect(result).toBe(principal);
    });

    it('should throw AuthenticationFailedException when err is provided', () => {
      const error = new Error('invalid signature');

      expect(() => {
        guard.handleRequest(error, null);
      }).toThrow(AuthenticationFailedException);
      expect(() => {
        guard.handleRequest(error, null);
      }).toThrow('Token de cliente inválido ou ausente');
    });

    it('should throw AuthenticationFailedException when the strategy resolved no user', () => {
      expect(() => {
        guard.handleRequest(null, false);
      }).toThrow(AuthenticationFailedException);
    });

    it('should throw AuthenticationFailedException when both err and user are present', () => {
      expect(() => {
        guard.handleRequest(new Error('Some error'), { sub: 'user-id' });
      }).toThrow(AuthenticationFailedException);
    });
  });
});
