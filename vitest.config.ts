import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/property/**/*.test.ts'],
    exclude: [
      'test/integration/**/*',
      'test/benchmark/**/*',
      'test/fuzz/**/*',
      'node_modules',
      'dist',
    ],
    globals: false,
    environment: 'node',
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts', 'cli/**/*.ts'],
      exclude: ['src/index.ts', 'cli/index.ts', '**/*.d.ts'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
    testTimeout: 10_000,
  },
});
