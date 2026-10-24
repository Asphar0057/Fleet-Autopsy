# Implementation Plan: Diagnosis Engine (Spec 3 of 4)

## Overview

Bottom-up: types and lint guards first, then evidence, hypotheses, scoring, the greedy diagnoser, baselines, verified fix, benchmark, worker, tuning and the committed benchmark, precompute and the dev readout. TypeScript strict, Vitest, fast-check 4.10.2 (already pinned). Scripts run under Vitest with `vitest.scripts.config.ts` (design D2); no new dependency. Each task ends with a test and one small commit with an imperative message. Do not push.

Rules for every task:
- Spec 1 and Spec 2 behaviour must not change: no edits under `src/sim`, and every existing test (golden hashes included) passes after every task.
- The Diagnoser never reads `config.faults` or imports values from `src/sim/scenarios` (lint-enforced from task 1).
- Debug rule: if accuracy is poor, log every attempt (hypothesis, change, dev-seed result) in `docs/spec3-debug.md`. At most 8 attempts. Tune only on dev seeds 100 to 120, never on benchmark seeds (≥ 1000) or curated scenarios. Never loosen pass criteria (fix threshold 0.7, `matchesGroundTruth`, jam detection). Revert changes that do not help; then stop and report honestly.

## Tasks

- [x] 1. Types, lint guards, and script runner
  - [x] 1.1 Create `src/diagnosis/types.ts` with `ObservedConfig`, `Target`, `Window`, `Evidence`, `RankedFault`, `ScoredHypothesis`, `Diagnosis`, `DiagnoseOptions`, `FixResult`, `DiagnoseRequest`, `WorkerLike`
    - _Requirements: 1.3, 4.2, 6.1, 8.4_
  - [x] 1.2 Edit `eslint.config.js` per design "ESLint changes": determinism rules on `src/diagnosis/**/*.ts`; `src/sim` blocks forbid `diagnosis`; Diagnoser block with `@typescript-eslint/no-restricted-imports` (`allowTypeImports` for `sim/scenarios`) and `no-restricted-syntax` for `.faults` reads; `src/diagnosis/**/*.tsx` in the react-hooks block
    - _Requirements: 2.4, 2.5_
  - [x] 1.3 Add `vitest.scripts.config.ts` (include `scripts/**/*.run.ts`, `testTimeout: 0`), `npm run benchmark` and `npm run precompute` scripts, and `scripts` to `tsconfig.node.json` include
    - _Requirements: 7.1, 9.1_
  - [x] 1.4 Write `tests/diagnosis-lint.test.ts` (required test 2): ESLint API `lintText` with `filePath` under `src/diagnosis`: `config.faults` and `const { faults } = config` error; value import from `../sim/scenarios` errors; `import type` passes; a file under `src/sim` importing `../diagnosis/diagnose` errors
    - _Requirements: 2.4, 2.5_
  - [x] 1.5 Check and commit: `npm test`, `npm run lint` pass; commit "add diagnosis types and lint guards against fault-list reads"

- [x] 2. Evidence extraction
  - [x] 2.1 Implement `extractEvidence` in `src/diagnosis/evidence.ts` per design (Diagnoser standstill rule with `SERVE_STALL`, stalled order, episodes, hot-spots, services, completions, throughput, moves, busy cells that went empty); reads only ticks ≤ `detectedTick`; `RangeError` out of range
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 2.2 Write `tests/evidence.test.ts` (required test 1): on `cp-door-freeze`, the earliest stalled robot is R7 with standstill start ≤ 351; on `pd-holder-freeze`, R4 is stalled while Serving
    - _Requirements: 1.2_
  - [x] 2.3 Write property test: **Property 1: Evidence is a deterministic, JSON-safe function of the prefix** (`numRuns: 10`)
    - **Validates: Requirements 1.1, 1.3**
  - [x] 2.4 Write property test: **Property 2: Stalled robots are ordered and real** (`numRuns: 10`)
    - **Validates: Requirements 1.2**
  - [x] 2.5 Check and commit: commit "extract jam evidence from recordings"

- [x] 3. Hypothesis generation and pre-score
  - [x] 3.1 Implement `generateHypotheses` and `preScore` in `src/diagnosis/hypotheses.ts` per the design table (K = 8 freezes, slowdown, blocked-cell, slow-robot; dedupe; deterministic order; `validateFaults` filter; cap 40)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 8.1_
  - [x] 3.2 Write examples in `tests/hypotheses.test.ts`: the true fault (same kind and target) is among the hypotheses and within the top 12 by pre-score on each curated scenario's Primary
    - _Requirements: 2.1, 8.1_
  - [x] 3.3 Write property test: **Property 3: Hypotheses are well-formed** (`numRuns: 10`)
    - **Validates: Requirements 2.3**
  - [x] 3.4 Write property test: **Property 4: Hypotheses ignore the fault list** (`numRuns: 10`)
    - **Validates: Requirements 2.2, 2.4**
  - [x] 3.5 Check and commit: commit "generate fault hypotheses from evidence"

- [x] 4. Counterfactual scoring
  - [x] 4.1 Implement `observationWindow`, `similarity`, `scoreHypothesis` in `src/diagnosis/score.ts` (post-onset weighted position match, throughput error, queue error, exact-1 short-circuit)
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 4.2 Write `tests/score.test.ts` examples (required test 3, part 1): exact replay of `pd-holder-freeze` with its own fault as base scores 1.0; a wrong fault (another robot frozen at the same tick) scores lower; the replay has `endTick + 1` frames and passes `verifyRun`
    - _Requirements: 3.1, 3.3_
  - [x] 4.3 Write property test: **Property 5: Similarity is bounded** (`numRuns: 10`)
    - **Validates: Requirements 3.2**
  - [x] 4.4 Write property test: **Property 6: Exact replay scores exactly 1** (`numRuns: 10`)
    - **Validates: Requirements 3.3**
  - [x] 4.5 Check and commit: commit "score hypotheses by counterfactual replay"

- [x] 5. Greedy diagnosis with progress and abort
  - [x] 5.1 Implement `diagnose` and `confidenceOf` in `src/diagnosis/diagnose.ts`: observed config on the first line, prune to 12, fault-free replay, greedy rounds (`ROUND_K`, `GAIN_MIN`, max 3), replay cache, impact per 100 ticks, root cause by impact, confidence, data-built evidence strings, `onProgress` after each replay, abort before each replay with `AbortError`, `elapsedMs` via the one allowed wall-clock line (D4)
    - _Requirements: 4.1, 4.2, 4.3, 8.1, 8.2, 8.3_
  - [x] 5.2 Add to `tests/score.test.ts` (required test 3, part 2): on each of the 5 single-fault curated scenarios, `diagnose` returns a `rootCause` that `matchesGroundTruth` the true fault; `faults.length ≤ 3`, every gain ≥ 0.02, round-1 scored hypotheses ≤ 12
    - _Requirements: 3.2, 4.1, 8.1_
  - [x] 5.3 Write `tests/diagnose.test.ts` determinism example (required test 7): two `diagnose` calls on `pd-holder-freeze` deep-equal after deleting `elapsedMs`; progress call count equals `replaysRun`
    - _Requirements: 4.4, 8.2_
  - [x] 5.4 Write property test: **Property 7: Confidence follows the fixed gaps** (`numRuns: 100`)
    - **Validates: Requirements 4.3**
  - [x] 5.5 Check and commit: commit "diagnose jams by greedy counterfactual selection"

- [x] 6. Baselines and the decoy headline
  - [x] 6.1 Implement `blameFirstAlarm`, `blameMostSevere`, `matchesGroundTruth`, `targetOf` in `src/diagnosis/baselines.ts`
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 6.2 Add to `tests/diagnose.test.ts` (required test 4): on `pd-decoy-first`, `blameFirstAlarm` names the decoy R6 (does not match the Primary) and `diagnose` names R3
    - _Requirements: 4.2, 5.1_
  - [x] 6.3 Add to `tests/diagnose.test.ts` (required test 5): on `pd-decoy-first`, assert both faults are selected; if the greedy loop selects only the Primary, change the test to assert the Primary only and record the multi-fault miss in `docs/spec3-debug.md` for honest reporting in RESULTS.md (do not loosen `GAIN_MIN` outside dev-seed tuning)
    - _Requirements: 4.1_
  - [x] 6.4 Write property test: **Property 8: Baselines match a reference model** (`numRuns: 100`)
    - **Validates: Requirements 5.1, 5.2**
  - [x] 6.5 Write property test: **Property 9: Ground-truth matching rule** (`numRuns: 100`)
    - **Validates: Requirements 5.3**
  - [x] 6.6 Check and commit: commit "add naive baselines and ground-truth matching"

- [x] 7. Verified fix
  - [x] 7.1 Implement `fixOutcome`, `verifyFix` (ticks = 2000, baseline = no-fault run, removes world faults matching the root cause, `verifiedBy: 'simulation'`) and `proposeFix` sentences in `src/diagnosis/fix.ts`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 7.2 Write `tests/fix.test.ts` (required test 6): `verifyFix` passes on all 6 curated scenarios using their diagnoses; a wrong fix (the decoy on `pd-decoy-first`, an unrelated robot elsewhere) fails; a null root cause gives `fix: null`, `passed: false`
    - _Requirements: 6.1, 6.2, 6.4_
  - [x] 7.3 Write property test: **Property 10: Fix pass rule** (`numRuns: 100`)
    - **Validates: Requirements 6.2**
  - [x] 7.4 Write property test: **Property 11: Proposed fixes name their target** (`numRuns: 100`)
    - **Validates: Requirements 6.3**
  - [x] 7.5 Check and commit: commit "verify proposed fixes in simulation"

- [x] 8. Benchmark runner
  - [x] 8.1 Implement `buildBenchmarkSet` (20 scenarios per layout from seeds ≥ 1000, skip seeds that throw; decoy and primary-only cases), `runBenchmark` (detect, diagnose, both baselines, reason codes, medians), and `renderResultsMd` in `src/diagnosis/benchmark.ts`; `BENCH_MODE` = `full` | `dev` (seeds 100 to 120) | `fast` (6 curated)
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 8.2 Write `scripts/benchmark.run.ts` that loads layouts with `fs`, runs the selected mode, and writes `benchmark/results.json` and `benchmark/RESULTS.md` (`dev` writes `benchmark/dev-results.json`, gitignored)
    - _Requirements: 7.1, 7.3_
  - [x] 8.3 Write `tests/benchmark.test.ts` (required test 8): fast mode on the 6 curated scenarios returns 12 case results with every field, accuracy by kind and overall, not-detected count, median replays and ms, failure reasons; RESULTS.md text contains those numbers; no files written
    - _Requirements: 7.2, 7.3_
  - [x] 8.4 Check and commit: commit "add diagnosis benchmark runner"

- [x] 9. Web Worker wrapper
  - [x] 9.1 Implement `src/diagnosis/worker.ts` (parse layout, run `diagnose`, post progress, done, error) and `diagnoseInWorker` in `src/diagnosis/client.ts` (optional `createWorker`, progress forwarding, abort terminates and rejects with `AbortError`)
    - _Requirements: 8.3, 8.4_
  - [x] 9.2 Write `tests/worker.test.ts` (required test 9): a fake worker emits two progress messages and a done result, and `onProgress` sees both; abort mid-run calls `terminate` once and rejects with `AbortError`; `diagnose` rejects with `AbortError` when aborted inside its first `onProgress`, with `replaysRun` stopped at 1
    - _Requirements: 8.2, 8.3, 8.4_
  - [x] 9.3 Check and commit: `npm run build` bundles the worker; commit "run diagnosis in a web worker with progress and abort"

- [ ] 10. Tune on dev seeds, run and commit the benchmark
  - [x] 10.1 Run `BENCH_MODE=dev npm run benchmark`; if accuracy is poor, follow the debug rule in `docs/spec3-debug.md` (max 8 attempts, dev seeds only, never loosen pass criteria)
    - _Requirements: 7.4_
  - [x] 10.2 Replace the design.md "Tuned constants" table with the final values and the dev-seed accuracy they gave
    - _Requirements: 7.4_
  - [x] 10.3 Run `npm run benchmark` once in full mode; commit `benchmark/results.json` and `benchmark/RESULTS.md` as produced, including failures and baseline comparison; `npm test` still passes
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 10.4 Commit: "tune diagnosis constants on dev seeds and commit benchmark results"

- [ ] 11. Precomputed autopsies and the dev readout
  - [~] 11.1 Implement `buildAutopsy` in `src/diagnosis/benchmark.ts` and `scripts/precompute.run.ts` writing `public/autopsies/<scenarioId>.json` for the 6 curated scenarios (no `elapsedMs`, no timestamps, trailing newline); run `npm run precompute`
    - _Requirements: 9.1, 9.2_
  - [~] 11.2 Write `tests/precompute.test.ts`: `buildAutopsy` for `pd-holder-freeze` and `pd-decoy-first` is byte-identical across two calls and equal to the committed files
    - _Requirements: 9.2_
  - [~] 11.3 Implement `src/diagnosis/DebugPanel.tsx` and `debugMount.tsx` (only under `?debug=diagnose`; curated select initialised from `?scenario=<id>`; `diagnoseInWorker` with observed config; progress line `replaying n of m timelines`; ranked faults; `verifyFix` result labelled sim-verified; real `<select>` and `<button>` with labels); add the one line `import './diagnosis/debugMount';` to `src/main.tsx`
    - _Requirements: 9.3, 9.4_
  - [~] 11.4 Visible check and commit: `npm run build` passes; `npm run dev` with `?debug=diagnose&scenario=pd-decoy-first` shows R3 as root cause and a passing fix; the app without the flag is unchanged. Commit "precompute curated autopsies and add diagnosis debug readout"

- [~] 12. Final checkpoint
  - Ensure `npm test`, `npm run lint`, and `npm run build` pass, Spec 1 golden hashes unchanged, `git diff --stat` shows no change under `src/sim` or `src/ui`; ask the user if questions arise
  - Commit any remaining fixes: "fix final spec 3 checks" (skip if nothing changed)

## Notes

- No sub-tasks are optional (the user asked to proceed without review stops).
- Property tests carry `// Feature: diagnosis, Property N: <title>`; run-level ones use `numRuns: 10` on pocket-dc and chokepoint with 300 to 600 ticks, pure ones `numRuns: 100`.
- Curated runs and diagnoses are memoized per test file; fulfillment-block tests set timeouts up to 180 s.
- Spec 4 seams: `diagnoseInWorker`, `public/autopsies/*.json`, `verifyFix`, `proposeFix`.
