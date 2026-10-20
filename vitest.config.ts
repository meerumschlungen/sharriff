import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Migrated to Deno's native test runner — excluded from vitest during transition
    exclude: [
      'tests/mutex.test.ts',
      'tests/shutdown.test.ts',
      'tests/logger.test.ts',
      'tests/config-parser.test.ts',
      'tests/http-client.test.ts',
      'tests/arr-client.test.ts',
      'tests/index.test.ts',
      'tests/orchestrator.test.ts',
      '**/node_modules/**',
      '**/dist/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
    },
  },
});
