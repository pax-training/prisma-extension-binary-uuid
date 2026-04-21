import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    globals: false,
    environment: 'node',
    // Integration tests spin real DBs via Testcontainers — give them runway.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    // One container per suite; don't fight over ports.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
});
