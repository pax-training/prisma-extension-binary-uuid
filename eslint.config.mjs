import tsEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'examples/**', 'docs/**'],
  },
  {
    files: ['src/**/*.ts', 'cli/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsEslint,
      'import': importPlugin,
    },
    rules: {
      // TS
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'off',

      // Imports
      'import/order': [
        'error',
        {
          'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          'alphabetize': { order: 'asc' },
        },
      ],
      'import/no-default-export': 'off',

      // General
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Tests get a bit more latitude
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Low-level byte/hex/UUID conversion + CLI parsers do bounded-array
    // indexing where every `!` is mathematically guaranteed (we just allocated
    // a 16-byte Uint8Array, or the byte value is in [0,255] which is the size
    // of the lookup table). With `noUncheckedIndexedAccess: true` enabled
    // globally, the alternative would be inserting a runtime branch on every
    // hot-path read — which we measured at ~30% slowdown for `uidFromBin`.
    files: [
      'src/conversion/uuid-binary.ts',
      'src/conversion/uuid-v4.ts',
      'src/conversion/uuid-v7.ts',
      'src/walker/args-walker.ts',
      'src/walker/result-walker.ts',
      'cli/parse-schema.ts',
      'cli/emit-config.ts',
      'cli/index.ts',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
