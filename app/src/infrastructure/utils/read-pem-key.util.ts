import { ConfigService } from '@nestjs/config';

/**
 * Reads a PEM public key from configuration. A single-line value with literal `\n`
 * (.env, GitHub variable) and a value with real line breaks (k8s Secret) are
 * both accepted. Fails at boot with the variable name instead of letting
 * passport-jwt fail later with a generic error.
 */
export function readPemKey(configService: ConfigService, name: string): string {
  const key = configService.getOrThrow<string>(name).replaceAll(String.raw`\n`, '\n');

  if (!key.includes('-----BEGIN PUBLIC KEY-----')) {
    throw new Error(
      `${name} não é uma chave pública PEM válida ` +
        '(esperado um bloco "-----BEGIN PUBLIC KEY-----")',
    );
  }

  return key;
}
