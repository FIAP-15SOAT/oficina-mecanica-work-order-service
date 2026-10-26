// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'generated/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-console': 'warn',
      'prefer-const': 'error',
      'no-var': 'error'
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/infrastructure/persistence/prisma/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@generated/*', '@generated/**'],
              message:
                'Somente infrastructure/persistence/prisma/ pode importar @generated/client (Prisma).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@nestjs/*',
                '@nestjs/**',
                '@generated/*',
                '@generated/**',
                '@opentelemetry/*',
                '@opentelemetry/**',
                '@aws-sdk/*',
                '@aws-sdk/**',
                'sqs-consumer',
                'ioredis',
                'mercadopago',
              ],
              message:
                'Camada interna (domain/application) deve ser livre de framework, ORM, telemetria e SDK externo: não importe @nestjs/*, @generated/* (Prisma), @opentelemetry/* (use a porta IMetrics), @aws-sdk/*, sqs-consumer, ioredis nem mercadopago (use a porta do adaptador em infrastructure/).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/interface-adapters/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@nestjs/*',
                '@nestjs/**',
                '@generated/*',
                '@generated/**',
                '@opentelemetry/*',
                '@opentelemetry/**',
                '@aws-sdk/*',
                '@aws-sdk/**',
                'sqs-consumer',
                'ioredis',
                'mercadopago',
              ],
              message:
                'interface-adapters/ é o anel de adaptadores livre de framework: não importe @nestjs/*, @generated/* (Prisma), @opentelemetry/*, @aws-sdk/*, sqs-consumer, ioredis nem mercadopago.',
            },
          ],
        },
      ],
    },
  },
);
