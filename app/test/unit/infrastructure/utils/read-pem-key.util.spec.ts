import { ConfigService } from '@nestjs/config';

import { readPemKey } from '@infrastructure/utils/read-pem-key.util';

const PUBLIC_PEM = '-----BEGIN PUBLIC KEY-----\nMIIBIjAN\n-----END PUBLIC KEY-----';

function configWith(value: string): ConfigService {
  return { getOrThrow: jest.fn().mockReturnValue(value) } as unknown as ConfigService;
}

describe('readPemKey', () => {
  it('returns the key with literal \\n turned into line breaks', () => {
    const singleLine = PUBLIC_PEM.replaceAll('\n', String.raw`\n`);

    expect(readPemKey(configWith(singleLine), 'STAFF_JWT_PUBLIC_KEY', 'PUBLIC')).toBe(PUBLIC_PEM);
  });

  it('returns a key that already has real line breaks unchanged', () => {
    expect(readPemKey(configWith(PUBLIC_PEM), 'STAFF_JWT_PUBLIC_KEY', 'PUBLIC')).toBe(PUBLIC_PEM);
  });

  it('throws naming the variable when the public key is not PEM', () => {
    expect(() => readPemKey(configWith('not-a-key'), 'CUSTOMER_JWT_PUBLIC_KEY', 'PUBLIC')).toThrow(
      'CUSTOMER_JWT_PUBLIC_KEY não é uma chave pública PEM válida ' +
        '(esperado um bloco "-----BEGIN PUBLIC KEY-----")',
    );
  });

  it('throws for a private key that is not PKCS#8 PEM', () => {
    const pkcs1 = '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----';

    expect(() => readPemKey(configWith(pkcs1), 'STAFF_JWT_PRIVATE_KEY', 'PRIVATE')).toThrow(
      'STAFF_JWT_PRIVATE_KEY não é uma chave privada PEM válida ' +
        '(esperado um bloco "-----BEGIN PRIVATE KEY-----")',
    );
  });
});
