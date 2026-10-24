/// <reference types="vitest/config" />
// Runs `scripts/*.run.ts` (benchmark, precompute) under Vitest, because `src`
// uses extensionless imports and no tsx / vite-node is installed (design D2).
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['scripts/**/*.run.ts'],
    environment: 'node',
    testTimeout: 0,
  },
});
