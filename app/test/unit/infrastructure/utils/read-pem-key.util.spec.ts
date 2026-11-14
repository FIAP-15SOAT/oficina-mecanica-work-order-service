import { ConfigService } from '@nestjs/config';

import { readPemKey } from '@infrastructure/utils/read-pem-key.util';

const PUBLIC_PEM = '-----BEGIN PUBLIC KEY-----\nMIIBIjAN\n-----END PUBLIC KEY-----';

function configWith(value: string): ConfigService {
  return { getOrThrow: jest.fn().mockReturnValue(value) } as unknown as ConfigService;
}

describe('readPemKey', () => {
  it('should return the key with literal \\n turned into line breaks', () => {
    const singleLine = PUBLIC_PEM.replaceAll('\n', String.raw`\n`);

    expect(readPemKey(configWith(singleLine), 'STAFF_JWT_PUBLIC_KEY')).toBe(PUBLIC_PEM);
  });

  it('should return a key that already has real line breaks unchanged', () => {
    expect(readPemKey(configWith(PUBLIC_PEM), 'STAFF_JWT_PUBLIC_KEY')).toBe(PUBLIC_PEM);
  });

  it('should throw naming the variable when the public key is not PEM', () => {
    expect(() => readPemKey(configWith('not-a-key'), 'CUSTOMER_JWT_PUBLIC_KEY')).toThrow(
      'CUSTOMER_JWT_PUBLIC_KEY não é uma chave pública PEM válida ' +
        '(esperado um bloco "-----BEGIN PUBLIC KEY-----")',
    );
  });
});
