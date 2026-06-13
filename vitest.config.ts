import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Engine golden runs are CPU-bound; keep output readable.
    silent: false,
    testTimeout: 120000,
  },
});
