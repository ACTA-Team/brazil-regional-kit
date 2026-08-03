import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    // The suite must be runnable offline and in CI without credentials, so
    // nothing here touches Horizon or an anchor. Network-dependent behaviour is
    // covered by injecting a fake `fetch` instead.
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
