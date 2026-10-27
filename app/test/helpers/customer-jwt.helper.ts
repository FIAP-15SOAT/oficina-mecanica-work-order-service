import { generateKeyPairSync } from 'node:crypto';
import { sign } from 'jsonwebtoken';

// RS256 key pair generated at runtime (never committed as a literal PEM) —
// used only to sign test tokens that stand in for the external Lambda (out of
// scope), both in the tests and in the local demo.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export const CUSTOMER_JWT_TEST_PRIVATE_KEY = privateKey;
export const CUSTOMER_JWT_TEST_PUBLIC_KEY = publicKey;

export const CUSTOMER_JWT_TEST_ISSUER = 'oficina-customer-auth';
export const CUSTOMER_JWT_TEST_AUDIENCE = 'oficina-api';

/**
 * Signs a test customer token — stands in for the Lambda (out of scope) in the
 * tests and in the local demo.
 */
export function signTestCustomerToken(userId: string, expiresInSeconds = 3600): string {
  return sign({ sub: userId }, CUSTOMER_JWT_TEST_PRIVATE_KEY, {
    algorithm: 'RS256',
    issuer: CUSTOMER_JWT_TEST_ISSUER,
    audience: CUSTOMER_JWT_TEST_AUDIENCE,
    expiresIn: expiresInSeconds,
  });
}
