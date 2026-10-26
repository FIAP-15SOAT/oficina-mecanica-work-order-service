import { generateKeyPairSync } from 'node:crypto';
import { sign, SignOptions } from 'jsonwebtoken';

// Ephemeral RS256 pairs generated at runtime (never committed as PEM): one for
// the staff access token and a separate one for the refresh token.
function generatePemKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

const accessPair = generatePemKeyPair();
const refreshPair = generatePemKeyPair();

export const STAFF_JWT_TEST_PRIVATE_KEY = accessPair.privateKey;
export const STAFF_JWT_TEST_PUBLIC_KEY = accessPair.publicKey;
export const STAFF_REFRESH_TEST_PRIVATE_KEY = refreshPair.privateKey;
export const STAFF_REFRESH_TEST_PUBLIC_KEY = refreshPair.publicKey;

export const STAFF_JWT_TEST_KEY_ID = 'staff-test';
export const STAFF_JWT_TEST_ISSUER = 'oficina-identity';
export const STAFF_JWT_TEST_AUDIENCE = 'oficina-services';

/** Signs a staff access token with the full profile; options and payload override it. */
export function signTestStaffToken(
  payload: object,
  options: SignOptions = {},
  privateKey: string = STAFF_JWT_TEST_PRIVATE_KEY,
): string {
  return sign({ typ: 'access', ...payload }, privateKey, {
    algorithm: 'RS256',
    keyid: STAFF_JWT_TEST_KEY_ID,
    issuer: STAFF_JWT_TEST_ISSUER,
    audience: STAFF_JWT_TEST_AUDIENCE,
    expiresIn: 600,
    ...options,
  });
}

/** Signs a staff refresh token: refresh key, the issuer as audience, no kid. */
export function signTestRefreshToken(payload: object): string {
  return sign({ typ: 'refresh', ...payload }, STAFF_REFRESH_TEST_PRIVATE_KEY, {
    algorithm: 'RS256',
    issuer: STAFF_JWT_TEST_ISSUER,
    audience: STAFF_JWT_TEST_ISSUER,
    expiresIn: '7d',
  });
}
