import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      // Integration tests use their own database, never the development one.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://oddhound:oddhound_local_dev@127.0.0.1:55433/oddhound_test',
      ODDHOUND_CREDENTIAL_KEY: 'test-only-credential-key-0123456789abcdef',
    },
  },
});
