# Implementation Plan: Simulation Core (Spec 1 of 4)

## Overview

Bottom-up build of the pure sim (`src/sim`), then a minimal renderer and App so moving robots are visible by task 6, then verifier tests, metrics, full UI, styling, perf, and the run-level property tests. TypeScript strict, Vite, React 18, Vitest, fast-check (pinned). Each task ends with a test or visible check and a commit.

## Tasks

- [x] 1. Scaffold the app, lint rules, and seeded PRNG
  - [x] 1.1 Set up Vite + React 18 + strict TS, Vitest, ESLint, fast-check (`--save-exact`), and the three `@fontsource` packages
    - Scripts: `dev`, `build`, `test` (`vitest --run`), `lint`
    - ESLint scoped to `src/sim/**`: `no-restricted-properties` (`Math.random`, `Date.now`, `performance.now`, `crypto.getRandomValues`), `no-restricted-globals` (`window`, `document`, `navigator`), `no-restricted-imports` (`src/ui`, `src/render`, `react`)
    - Create the folder structure from the prompt
    - _Requirements: 2.7_
  - [x] 1.2 Implement `src/sim/types.ts` and `src/sim/rng.ts` (`mulberry32`, `randInt`)
    - _Requirements: 2.2, 2.5, 2.6_
  - [x] 1.3 Write property test in `tests/determinism.test.ts`
    - **Property 3: PRNG is deterministic and in range** (`numRuns: 100`)
    - **Validates: Requirements 2.2**
  - [x] 1.4 Check and commit
    - `npm test` and `npm run lint` pass; a temporary `Math.random` in `src/sim` fails lint, then is removed
    - Commit: "scaffold vite app with sim lint rules and seeded rng"

- [x] 2. Layout loader and printer
  - [x] 2.1 Implement `parseGrid`, `parseLayout`, `printGrid` in `src/sim/layout.ts`
    - Neighbor table (E, W, S, N), station access cells, `stationAt`, `accessOf`, validation order and error messages from the design
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
  - [x] 2.2 Write example tests in `tests/layout.test.ts` (required test 3)
    - All three presets load via `fs` with JSON counts, floor connected, every endpoint has a floor neighbor; bad grids throw descriptive errors
    - _Requirements: 1.2, 1.3, 1.4, 1.5_
  - [x] 2.3 Write property test: **Property 1: Grid round trip** (`numRuns: 100`)
    - **Validates: Requirements 1.1, 1.7, 1.8**
  - [x] 2.4 Write property test: **Property 2: Validation agrees with a reference checker** (`numRuns: 100`)
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.6**
  - [x] 2.5 Commit: "add layout loader with validation and grid printer"

- [x] 3. Blocked-aware distance cache
  - [x] 3.1 Implement `createDistanceCache` in `src/sim/distance.ts` (BFS, access cells blocked except `allowAccess`, cache key `goal * (cells + 1) + allowAccess + 1`)
    - _Requirements: 3.6, 10.5_
  - [x] 3.2 Write property test in `tests/pibt.test.ts`: **Property 6: Distance maps respect blocked access cells** (`numRuns: 100`)
    - Include a unit check that a repeated `get` returns the same `Int16Array` instance
    - **Validates: Requirements 3.6**
  - [x] 3.3 Commit: "add blocked-aware bfs distance cache"

- [x] 4. PIBT planner
  - [x] 4.1 Implement `createPlanner` / `plan` in `src/sim/pibt.ts`
    - Pinned robots claimed first, insertion sort by (−prio, id), recursive `pibt` with inheritance, backtracking, no swap, endpoint and access-cell filter, `tieRot` ordering, preallocated scratch
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.9, 10.5_
  - [x] 4.2 Write example test (required test 4): head-on in a one-cell aisle with a side pocket
    - Small hand-built layout; loop `plan` until both robots reach goals; assert no swap and no shared cell each step
    - _Requirements: 3.4, 3.10_
  - [x] 4.3 Write property test: **Property 7: Planner output is safe** (`numRuns: 100`)
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.9**
  - [x] 4.4 Commit: "add pibt planner with priority inheritance and pinned robots"

- [x] 5. Recorder and sim tick loop
  - [x] 5.1 Implement `src/sim/recorder.ts` (doubling typed buffers, `positionsAt`, `statesAt`, FNV-1a `hashRecording`)
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6_
  - [x] 5.2 Write property test in `tests/verify.test.ts`: **Property 11: Recorder round trip** (`numRuns: 100`)
    - Push enough frames to force growth; `positionsAt` / `statesAt` throw `RangeError` out of range
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5, 7.3**
  - [x] 5.3 Implement `createSim` in `src/sim/sim.ts`
    - Seeded spawn (D2), tick order steps 1 to 5, task selection with admission and Queue_Cap, seeded pod draw (D16), service 8 to 14 ticks, pod slot reservation, effective priority tiers (idle −2, queued non-holder −1)
    - Release only after the holder left both station cell and Access_Cell; holder selection via exported `pickHolder` with `accessDist = cache.get(access[s], access[s])` (D18)
    - Exported `stallDue` (D17); stall events; `faults` accepted and ignored; `createSim` input checks
    - _Requirements: 2.1, 2.3, 2.5, 2.6, 2.8, 3.2, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.4_
  - [x] 5.4 Write unit tests in `tests/pibt.test.ts`
    - Required test 6: hand-built station hand-off, departing holder and next robot at the access cell, no deadlock within 100 ticks
    - `pickHolder` with `dist(access[s], allowAccess = access[s])` picks the nearest queued robot, ties by lower id
    - Effective-priority tiers; `stallDue` fires once at 200 ticks and never for serving or idle robots; `createSim` rejects bad configs
    - _Requirements: 3.7, 3.8, 4.5, 4.7, 5.4_
  - [x] 5.5 Implement `verifyRun` in `src/sim/verify.ts` (same-cell, swap, jump, illegal-cell per D5, stamp array)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 5.6 Write required test 5 in `tests/health.test.ts` and run it before committing
    - Each preset at recommended robots and queue cap, seeds 1 to 3, 2,000 ticks: 0 violations (via `verifyRun`), every robot ≥ 1 deliver, no stall events; log throughput per 100 ticks
    - If it fails, stop and report the failing preset and seed. Do not commit and do not continue to task 6.
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 5.7 Commit: "add sim tick loop, station hand-off, recorder, verifier, and health test"

- [x] 6. Minimal renderer and App showing moving robots
  - [x] 6.1 Implement `fitCanvas` and `drawFrame` in `src/render/canvasRenderer.ts` (walls as edges, pod slots, stations with numbers, chargers with plus, robot dots, carry ring)
    - _Requirements: 1.9, 8.1, 8.2, 8.3, 8.4_
  - [x] 6.2 Implement a minimal `src/ui/App.tsx` + `main.tsx`
    - Fetch `layouts.json` and the grid, `parseLayout`, create fulfillment-block with 36 robots and a default seed, rAF loop at 10 ticks/s calling `step()` and `drawFrame`
    - _Requirements: 9.1_
  - [x] 6.3 Visible check and commit
    - `npm run build` passes; `npm run dev` shows robots moving on fulfillment-block
    - Commit: "add canvas renderer and app loop with moving robots"

- [x] 7. Verifier tests and badge text
  - [x] 7.1 Implement a pure `badgeText(violations, ticks)` helper in `src/ui/badge.ts`
    - _Requirements: 6.5, 6.6_
  - [x] 7.2 Write unit tests in `tests/verify.test.ts` (required test 2)
    - Hand-built same-cell and swap recordings flagged with tick and robot ids; jump and wall cases; endpoint-after-pick stays legal; badge text for 0 and N violations
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 7.3 Commit: "add verifier tests and badge text"

- [x] 8. Metrics
  - [x] 8.1 Implement `src/sim/metrics.ts` (`throughputAt`, `throughputSeries`, `meanCycleTime`, `queueLengths`, `createWaitCounter` with incremental cache)
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 8.2 Write property test in `tests/verify.test.ts`: **Property 13: Metrics match naive models** (`numRuns: 100`)
    - **Validates: Requirements 7.1, 7.2**
  - [x] 8.3 Write unit test: wait counter on a hand-built recording, forward then backward queries
    - _Requirements: 7.4_
  - [x] 8.4 Commit: "add throughput, cycle time, queue, and wait-count metrics"

- [x] 9. Full playback UI and renderer overlays
  - [x] 9.1 Add trails, congestion hatching, and stall ring with `R17 · STALL` label to `drawFrame`
    - _Requirements: 8.5, 8.6, 8.7, 8.8_
  - [x] 9.2 Implement `Controls.tsx`, `Scrubber.tsx`, `Panel.tsx` and wire them in `App.tsx`
    - Layout switcher, robot slider to max robots, seed input, play/pause, 1×/4×/16×, step back/forward, congestion and trail toggles (`aria-pressed`), scrubber with throughput line and event ticks
    - Panel: `01 VERIFIER` badge, `02 METRICS` with sparkline, `03 STATIONS` queue lengths, `04 ASSUMPTIONS` with "validated in simulation only"; loader errors shown in mono
    - New Sim on layout, robots, or seed change; scrubbing reads the Recording without stepping; space and ←/→ keys (ignored in text inputs)
    - _Requirements: 6.5, 6.6, 7.5, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.9_
  - [x] 9.3 Visible check and commit
    - `npm run build` and `npm run lint` pass; in `npm run dev` each control, the scrubber, and the keyboard work; badge reads `VERIFIED · 0 VIOLATIONS · N TICKS`
    - Commit: "add playback controls, scrubber, panel, and overlays"

- [ ] 10. Styling per design.md
  - [ ] 10.1 Write `src/styles/tokens.css` and `base.css`; import fonts
    - Header with wordmark "Fleet *Autopsy*" and mono meta, two-thirds/one-third split with 1px rules, stacked below 1024px, button hover invert, 2px focus outline, slider square thumb, mono uppercase labels, tabular figures, `prefers-reduced-motion` disables transitions
    - Renderer reads colors from CSS custom properties once at mount
    - _Requirements: 8.8, 9.7, 9.8_
  - [ ] 10.2 Visible check and commit
    - `npm run build` passes; compare `npm run dev` against `docs/layouts-preview.png` at 1280px and 1024px
    - Commit: "style app with design tokens and editorial layout"

- [ ] 11. Performance smoke test
  - [ ] 11.1 Write `tests/perf.test.ts` (required test 7)
    - fulfillment-block, 1,000 headless ticks, log elapsed ms at 36 and 45 robots; never fail on time
    - _Requirements: 10.4, 10.5_
  - [ ] 11.2 If timing is far above 1.5 s, profile and remove per-tick allocations in `sim.ts` / `pibt.ts`, keeping all tests green
    - _Requirements: 10.5_
  - [ ] 11.3 Commit: "add headless perf smoke test"

- [ ] 12. Determinism and run-level property tests
  - [ ] 12.1 Write required test 1 in `tests/determinism.test.ts`: same seed same hash, different seed different hash
    - _Requirements: 2.3, 2.4_
  - [ ] 12.2 Write property test in `tests/determinism.test.ts`: **Property 4: Same inputs, same recording** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 2.3, 2.6, 5.6**
  - [ ] 12.3 Write property test in `tests/determinism.test.ts`: **Property 5: Different seeds, different recordings** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 2.4**
  - [ ] 12.4 Write property test in `tests/health.test.ts`: **Property 8: Runs are verifier-clean** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 2.1, 3.4, 3.5, 4.8, 10.1**
  - [ ] 12.5 Write property test in `tests/health.test.ts`: **Property 9: Station exclusivity and queue cap** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 4.1, 4.2, 4.6, 4.7**
  - [ ] 12.6 Write property test in `tests/health.test.ts`: **Property 10: Task cycle and pod exclusivity** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 4.3, 4.4**
  - [ ] 12.7 Write property test in `tests/health.test.ts`: **Property 12: Verifier detects injected faults** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
  - [ ] 12.8 Write property test in `tests/health.test.ts`: **Property 14: Incremental wait counts match a recount** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 7.4**
  - [ ] 12.9 Final check and commit
    - `npm test`, `npm run lint`, and `npm run build` pass; fix any sim bug a property exposes before committing
    - Commit: "add determinism and run-level property tests"

## Notes

- No sub-tasks are optional: required tests 1 to 7 and all 14 properties are part of the plan.
- Run-level properties (4, 5, 8, 9, 10, 12, 14) use `numRuns: 25`; all others use `numRuns: 100`.
- Every property test carries `// Feature: sim-core, Property N: <title>`.
- UI and renderer requirements (8.x, 9.x) are checked visually in `npm run dev`.
- Task 5 ends with the health test as a gate: if any preset/seed fails, stop and report it before task 6.
