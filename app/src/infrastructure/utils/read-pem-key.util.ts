import { ConfigService } from '@nestjs/config';

const KEY_LABEL = { PUBLIC: 'pública', PRIVATE: 'privada' } as const;

/**
 * Reads a PEM key from configuration. A single-line value with literal `\n`
 * (.env, GitHub variable) and a value with real line breaks (k8s Secret) are
 * both accepted. Fails at boot with the variable name instead of letting
 * passport-jwt or jsonwebtoken fail later with a generic error.
 */
export function readPemKey(
  configService: ConfigService,
  name: string,
  type: keyof typeof KEY_LABEL,
): string {
  const key = configService.getOrThrow<string>(name).replaceAll(String.raw`\n`, '\n');

  if (!key.includes(`-----BEGIN ${type} KEY-----`)) {
    throw new Error(
      `${name} não é uma chave ${KEY_LABEL[type]} PEM válida ` +
        `(esperado um bloco "-----BEGIN ${type} KEY-----")`,
    );
  }

  return key;
}
