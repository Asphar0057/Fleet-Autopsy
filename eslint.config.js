import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const reactPaths = [
  { name: 'react', message: 'src/sim is pure; no react' },
  { name: 'react-dom', message: 'src/sim is pure; no react' },
];
const uiRenderReactPatterns = [
  {
    group: ['**/ui', '**/ui/*', '**/ui/**', 'src/ui', 'src/ui/**'],
    message: 'src/sim must not import from src/ui',
  },
  {
    group: ['**/render', '**/render/*', '**/render/**', 'src/render', 'src/render/**'],
    message: 'src/sim must not import from src/render',
  },
  { group: ['react/*', 'react-dom/*'], message: 'src/sim is pure; no react' },
];
// src/sim never imports the diagnosis engine (Spec 3).
const noDiagnosisPattern = {
  regex: '(^|/)diagnosis(/|$)',
  message: 'src/sim must not import from src/diagnosis',
};

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
    files: ['src/ui/**/*.{ts,tsx}', 'src/diagnosis/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Determinism rules for the simulation core and the diagnosis engine
  // (tech.md, Spec 1 Requirement 2.7, Spec 3 design "ESLint changes").
  {
    files: ['src/sim/**/*.ts', 'src/diagnosis/**/*.ts'],
    ignores: ['src/diagnosis/client.ts'],
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
    },
  },
  // Purity of the simulation core.
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: reactPaths, patterns: [...uiRenderReactPatterns, noDiagnosisPattern] },
      ],
    },
  },
  // Telemetry and jam detection read only Recording and Layout (Spec 2, Requirement 3.1).
  // This block replaces the src/sim no-restricted-imports entry for these files, so it
  // repeats the react / ui / render / diagnosis restrictions.
  {
    files: ['src/sim/telemetry.ts', 'src/sim/jam.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: reactPaths,
          patterns: [
            {
              regex: '(^|/)(faults|sim|oracle|scenarios)(\\.[jt]s)?$',
              message: 'telemetry and jam detection must not read faults or sim internals (Requirement 3.1)',
            },
            ...uiRenderReactPatterns,
            noDiagnosisPattern,
          ],
        },
      ],
    },
  },
  // The Diagnoser never sees the fault list (Spec 3, Requirements 2.4, 2.5).
  // Only fix.ts, benchmark.ts, and the dev readout may read the World_Config.
  {
    files: [
      'src/diagnosis/evidence.ts',
      'src/diagnosis/hypotheses.ts',
      'src/diagnosis/score.ts',
      'src/diagnosis/diagnose.ts',
      'src/diagnosis/baselines.ts',
      'src/diagnosis/types.ts',
      'src/diagnosis/worker.ts',
      'src/diagnosis/client.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: reactPaths,
          patterns: [
            {
              regex: '(^|/)sim/scenarios(\\.[jt]s)?$',
              allowTypeImports: true,
              message: 'the diagnoser may import only types from src/sim/scenarios (Requirement 2.5)',
            },
            ...uiRenderReactPatterns,
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='faults']",
          message: 'the diagnoser must not read the fault list (Requirement 2.4)',
        },
        {
          selector: "ObjectPattern > Property[key.name='faults']",
          message: 'the diagnoser must not read the fault list (Requirement 2.4)',
        },
      ],
    },
  },
);
