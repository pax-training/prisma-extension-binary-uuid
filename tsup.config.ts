import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: false,
    minify: false,
    target: 'node18',
    outDir: 'dist',
    // Keep peer deps external so consumers supply their own Prisma.
    external: ['@prisma/client'],
  },
  {
    entry: {
      'cli/index': 'cli/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    splitting: false,
    minify: false,
    target: 'node18',
    outDir: 'dist',
    external: ['@prisma/client'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
