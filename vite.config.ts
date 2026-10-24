/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Diagnosis files replay many timelines; with one worker per core they starve the
    // other files (ESLint cold start, run-level properties) past their timeouts.
    maxWorkers: '50%',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
