import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Determinism and purity rules for the simulation core (tech.md, Requirement 2.7).
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'use the seeded rng (mulberry32) from src/sim/rng.ts' },
        { object: 'Date', property: 'now', message: 'src/sim must not read wall-clock time' },
        { object: 'performance', property: 'now', message: 'src/sim must not read wall-clock time' },
        { object: 'crypto', property: 'getRandomValues', message: 'use the seeded rng (mulberry32) from src/sim/rng.ts' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/sim must not touch the DOM' },
        { name: 'document', message: 'src/sim must not touch the DOM' },
        { name: 'navigator', message: 'src/sim must not touch the DOM' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/sim is pure; no react' },
            { name: 'react-dom', message: 'src/sim is pure; no react' },
          ],
          patterns: [
            {
              group: ['**/ui', '**/ui/*', '**/ui/**', 'src/ui', 'src/ui/**'],
              message: 'src/sim must not import from src/ui',
            },
            {
              group: ['**/render', '**/render/*', '**/render/**', 'src/render', 'src/render/**'],
              message: 'src/sim must not import from src/render',
            },
            { group: ['react/*', 'react-dom/*'], message: 'src/sim is pure; no react' },
          ],
        },
      ],
    },
  },
  // Telemetry and jam detection read only Recording and Layout (Spec 2, Requirement 3.1).
  // This block replaces the src/sim no-restricted-imports entry for these files, so it
  // repeats the react / ui / render restrictions.
  {
    files: ['src/sim/telemetry.ts', 'src/sim/jam.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/sim is pure; no react' },
            { name: 'react-dom', message: 'src/sim is pure; no react' },
          ],
          patterns: [
            {
              regex: '(^|/)(faults|sim|oracle|scenarios)(\\.[jt]s)?$',
              message: 'telemetry and jam detection must not read faults or sim internals (Requirement 3.1)',
            },
            {
              group: ['**/ui', '**/ui/*', '**/ui/**', 'src/ui', 'src/ui/**'],
              message: 'src/sim must not import from src/ui',
            },
            {
              group: ['**/render', '**/render/*', '**/render/**', 'src/render', 'src/render/**'],
              message: 'src/sim must not import from src/render',
            },
            { group: ['react/*', 'react-dom/*'], message: 'src/sim is pure; no react' },
          ],
        },
      ],
    },
  },
);
