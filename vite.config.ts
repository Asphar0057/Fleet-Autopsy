/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Diagnosis files replay many timelines in parallel workers; under that load the
    // ESLint cold start and run-level properties exceed the 5 s default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
