import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'evidence/remediation/R-4/coverage',
      reporter: ['text', 'text-summary', 'json-summary'],
      include: ['src/modules/**/*.ts'],
      exclude: ['**/*.d.ts'],
    },
  },
});
