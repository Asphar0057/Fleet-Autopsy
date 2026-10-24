# Tech

## Stack
- Vite, React 18, TypeScript (strict), Canvas 2D for the warehouse view.
- Vitest for tests. ESLint with the rules below. Plain CSS with custom properties; no UI library, no Tailwind.
- Fonts via npm: `@fontsource/instrument-serif`, `@fontsource/geist`, `@fontsource/geist-mono`.
- Deploy target: Vercel static build. No backend until Spec 4 (a single optional serverless function for the AI report, with cached fallbacks).

## Commands
`npm run dev`, `npm run build`, `npm test`, `npm run lint`.

## Determinism rules (enforce with ESLint `no-restricted-properties` and `no-restricted-globals` scoped to `src/sim/**`)
- No `Math.random`, `Date.now`, `performance.now`, `crypto.getRandomValues` in `src/sim`.
- All randomness comes from the seeded PRNG passed in the config (mulberry32).
- `src/sim` never imports from `src/ui` or `src/render`, and never touches the DOM.
- No module-level mutable state in `src/sim`. A sim instance owns all its state.
- Iterate in a stable order (by robot id, by cell index). Never rely on object key order or Set iteration for decisions.

## Performance
- Typed arrays for positions, priorities, distance maps. No per-tick object allocation in hot loops.
- Target: 1,000 ticks with 45 robots headless in about 1.5 seconds or less. Counterfactual replays will run in a web worker.

## Structure
`src/sim` (pure), `src/render`, `src/ui`, `src/styles`, `tests`, `public/layouts`.

## Quality
- Strict TypeScript, no `any`.
- Every sim module has unit tests. A run must always pass `verifyRun`.
- Accessibility basics: buttons are real buttons, keyboard controls for playback, `aria-label` on icon-only controls, honor `prefers-reduced-motion`.

## Git
Small commits after each task, imperative messages ("add PIBT step with priority inheritance"). The commit history is part of the submission.
