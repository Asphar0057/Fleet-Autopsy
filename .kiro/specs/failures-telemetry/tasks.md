# Implementation Plan: Failures, Telemetry, Jam Detection (Spec 2 of 4)

## Overview

Bottom-up: lock Spec 1 hashes first, then fault types and validation, fault effects in the sim, blocked cells, verifier and headless seam, telemetry, jam detector, oracle, curated scenarios, generator, and finally the UI. TypeScript strict, Vitest, fast-check 4.10.2 (already pinned in `package.json`, no install needed). Each task ends with a test or visible check and one small commit with an imperative message. Do not push.

Rules for every task:
- Fault-free behavior must not change: `tests/golden.test.ts` and all Spec 1 tests must pass after every task. The only allowed Spec 1 test edit is determinism Property 4 (design D22).
- Debug rule: if a health, golden, jam, or oracle test fails, do not loosen thresholds. Diagnose first: dump stuck robots (id, cell, state, goal, standstill) and station state (holder, queue, pending) around the failing tick, and compare against the Spec 1 rules in `.kiro/specs/sim-core/design.md`. Log every attempt (hypothesis, change, result) in `docs/spec2-debug.md`. At most 8 attempts; revert changes that do not help; then stop and report.
- For curated scenarios, a fault that does not hurt throughput is mis-placed: move it (design D23), never change thresholds.

## Tasks

- [x] 1. Lock Spec 1 hashes and add fault types with validation
  - [x] 1.1 Write `tests/golden.test.ts` before touching `src/sim`
    - Run the current code for 3 presets × seeds 1 to 3 × 2,000 ticks at recommended robots and hard-code the `hashRecording` values
    - _Requirements: 1.9_
  - [x] 1.2 Replace the `FaultEvent` stub in `src/sim/types.ts` with the discriminated union; add `'blocked-cell'` to `Violation['kind']`
    - _Requirements: 1.1_
  - [x] 1.3 Implement `isActive`, `validateFaults`, `blockableCells` in `src/sim/faults.ts`; call `validateFaults` from `createSim`
    - Field ranges, D8 union check (floor, not access, connected, every endpoint keeps a floor neighbor), descriptive errors
    - _Requirements: 1.1, 1.6_
  - [x] 1.4 Edit `tests/determinism.test.ts` Property 4 per D22 (faults after the run end give the Spec 1 hash) and add a `faultArb` generator to `tests/helpers.ts`
    - _Requirements: 1.9_
  - [x] 1.5 Write property test in `tests/faults.test.ts`: **Property 7: Block validation agrees with a reference checker** (`numRuns: 100`)
    - **Validates: Requirements 1.6**
  - [x] 1.6 Check and commit: `npm test`, `npm run lint` pass; commit "add fault event union and fault validation"

- [x] 2. Apply freeze, slow-robot, and station-slowdown in the sim
  - [x] 2.1 Implement `createFaultState` (`frozen`, `slowPin`, `factor`; no allocation in `update`) and wire step 0, task-phase skip, pinning, age, and factor into `src/sim/sim.ts`
    - Gate all fault code on `faults.length > 0`; keep the `tieRot` draw unchanged (D3 to D6)
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.9_
  - [x] 2.2 Write example tests in `tests/faults.test.ts`: freeze keeps the robot in place and it is never pushed; slow robot moves only on multiples of the period; slowdown scales only services started in the window; a faults array that takes effect changes the hash
    - _Requirements: 1.2, 1.3, 1.5, 1.8_
  - [x] 2.3 Write property test: **Property 3: Frozen robots stay put and pause their task** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 1.2**
  - [x] 2.4 Write property test: **Property 4: Slow robots move only on period ticks** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 1.5**
  - [x] 2.5 Write property test: **Property 5: Station slowdown scales only services started while active** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 1.3**
  - [x] 2.6 Check and commit: golden and health tests unchanged; commit "apply freeze, slow-robot, and station-slowdown faults"

- [x] 3. Blocked cells in distance cache, planner, and sim
  - [x] 3.1 Add `setBlocked(mask)` with the versioned key to `src/sim/distance.ts` (D10)
    - _Requirements: 1.4_
  - [x] 3.2 Add the blocked mask and `refreshBlocked()` to `src/sim/pibt.ts` (D11)
    - _Requirements: 1.4_
  - [x] 3.3 Implement engagement in `FaultState.update` (D7) and the pod-selection guard (D9) in `src/sim/sim.ts`
    - _Requirements: 1.4, 1.7_
  - [x] 3.4 Write example test: a block whose cell is occupied engages only on the first tick the cell is empty, then no robot enters until the window ends
    - _Requirements: 1.4_
  - [x] 3.5 Write property test: **Property 6: Distance maps exclude blocked cells** (`numRuns: 100`)
    - **Validates: Requirements 1.4**
  - [x] 3.6 Check and commit: golden tests unchanged; commit "add blocked cells to distance cache and planner"

- [x] 4. Verifier block rule and headless seam
  - [x] 4.1 Implement `blockWindows` and `blockedAt` in `src/sim/faults.ts`; add the optional `faults` argument and `blocked-cell` rule to `verifyRun`
    - _Requirements: 2.1, 2.2_
  - [x] 4.2 Export `runHeadless` from `src/sim/sim.ts`; example test that it equals `createSim` + `run`; add a logged faulted 2,000-tick fulfillment-block run at 36 robots to `tests/perf.test.ts`
    - _Requirements: 7.1, 7.3_
  - [x] 4.3 Write property test: **Property 1: Faulted runs are deterministic, order-independent, and removal-consistent** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 1.8, 7.2**
  - [x] 4.4 Write property test: **Property 2: Faulted runs are verifier-clean** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 1.4, 2.1, 2.2, 2.3**
  - [x] 4.5 Write property test: **Property 8: Verifier detects blocked-cell entries** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 2.1**
  - [x] 4.6 Check and commit: commit "add blocked-cell verifier rule and runHeadless"

- [ ] 5. Telemetry
  - [x] 5.1 Implement `src/sim/telemetry.ts` (`jamWindow`, `createTelemetryTracker`, `deriveTelemetry`) per design; add an ESLint `no-restricted-imports` block so `telemetry.ts` and `jam.ts` cannot import `faults`, `sim`, `oracle`, or `scenarios`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 5.2 Write `tests/telemetry.test.ts` examples: standstill resets on move, serving, and idle; service ring keeps the last 5; RangeError out of range; log the time to derive 2,000 ticks × 45 robots
    - _Requirements: 3.2, 3.3, 3.5_
  - [x] 5.3 Write property test: **Property 9: Telemetry matches a naive recount** (`numRuns: 25`, 300 ticks)
    - **Validates: Requirements 3.2, 3.3, 3.4**
  - [-] 5.4 Check and commit: `npm run lint` passes; commit "derive telemetry from recordings"

- [ ] 6. Jam detector and healthy-baseline gate
  - [~] 6.1 Implement `src/sim/jam.ts` (`baselineAt`, `detectJam`, histogram median, latched detection, onset and severity per D16, D17)
    - _Requirements: 4.1, 4.2, 4.3_
  - [~] 6.2 Write property test in `tests/jam.test.ts`: **Property 10: Jam detector matches a reference model** (`numRuns: 100`)
    - **Validates: Requirements 4.1, 4.2, 4.3**
  - [~] 6.3 Write the healthy gate: 3 presets × seeds 1 to 5 × 2,000 ticks return null; log per-run minimum throughput / Baseline ratio and max stalled100
    - If a run false-alarms, apply the debug rule; the only allowed remedy beyond fixing a bug is the D18 200-tick window for layouts under 20 deliveries per 100 ticks, recorded in design.md D18 and the Assumptions text
    - _Requirements: 4.4_
  - [~] 6.4 Check and commit: commit "add jam detector with healthy-baseline gate"

- [ ] 7. Oracle
  - [~] 7.1 Implement `deliveries`, `scoreFaults`, `isValid` in `src/sim/oracle.ts` (D14) using `runHeadless`
    - _Requirements: 6.1, 6.2_
  - [~] 7.2 Write example test in `tests/scenarios.test.ts`: a single-fault config gives recovered exactly 1 (removed run equals baseline)
    - _Requirements: 6.1_
  - [~] 7.3 Write property test: **Property 11: Validity rule matches its formula** (`numRuns: 100`)
    - **Validates: Requirements 6.2**
  - [~] 7.4 Check and commit: commit "add fault oracle with recovered-fraction scoring"

- [ ] 8. Curated scenarios with verified ground truth
  - [~] 8.1 Fill the `R?` / `station ?` placements from the fault-free runs with a throwaway helper (deleted before commit), then hard-code `SCENARIOS` and `scenarioConfig` in `src/sim/scenarios.ts`
    - Every curated fault must block through-traffic (one-cell aisle, door, station service slot); the decoy goes on open floor
    - _Requirements: 5.1, 5.2_
  - [~] 8.2 Write tests in `tests/scenarios.test.ts`: ≥ 6 scenarios, 2 per layout, decoy tick before primary; placement predicates from the design table; each scenario `isValid` by `scoreFaults` and verifier-clean over 2,000 ticks
    - _Requirements: 2.3, 5.1, 5.2, 5.3, 6.2_
  - [~] 8.3 Write tests in `tests/jam.test.ts`: each curated scenario detected within 200 ticks after its primary tick; decoy-first onset closer to the primary than to the decoy
    - If a scenario fails, move the fault (debug rule applies to sim bugs); record final placements in the design.md Scenarios table
    - _Requirements: 4.5, 4.6_
  - [~] 8.4 Check and commit: commit "add curated failure scenarios with oracle-verified ground truth"

- [ ] 9. Scenario generator
  - [~] 9.1 Implement `generateScenarios(layout, seed, count)` in `src/sim/oracle.ts` per D13 (seeded rejection sampling, decoy-first pairs, attempt bound `30 × count`, descriptive throw)
    - _Requirements: 6.3, 6.4, 6.5_
  - [~] 9.2 Write tests: `generateScenarios(pocket-dc, 1, 3)` returns 3 scenarios that pass `isValid` and is deep-equal on a second call; an attempt bound of 0 (internal option) throws
    - _Requirements: 6.3, 6.4, 6.5_
  - [~] 9.3 Check and commit: commit "add deterministic scenario generator"

- [ ] 10. Scenario select, block drawing, and ground-truth reveal
  - [~] 10.1 Extend `drawFrame` with `blocked` (ink cross-hatched square) and `reveal` (accent square and `F1` tags) per D21
    - _Requirements: 8.3, 8.4_
  - [~] 10.2 Add the scenario select and `reveal ground truth` toggle (`aria-pressed`) to `Controls.tsx`; scenario state, faults in the Sim memo, D19 reset rule, `verifyRun` with faults, `blockedAt` per frame in `App.tsx`; fault ticks in `Scrubber.tsx`; pure `faultLegend` in `src/ui/legend.ts` shown under the canvas when revealed
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [~] 10.3 Write a unit test for `faultLegend` in `tests/ui.test.ts`
    - _Requirements: 8.4_
  - [~] 10.4 Visible check and commit: `npm run build` passes; in `npm run dev` choosing a scenario updates layout, robots, and seed; no fault markers until reveal; blocks hatched; legend and scrubber ticks on reveal; all reachable by keyboard. Commit "add scenario select and ground-truth reveal"

- [ ] 11. Telemetry panel, jam badge, assumptions, README
  - [~] 11.1 Implement `jamBadgeText` in `src/ui/jamBadge.ts`, `JamBadge` and `TelemetryPanel.tsx` (sparkline with accent onset marker, queue bars, stalled ≥ 20 count, disabled "Find the cause" with caption "available in the next step"); renumber panel sections (D20)
    - _Requirements: 9.1, 9.2, 9.3_
  - [~] 11.2 In `App.tsx`, create a tracker per Sim and run `advance(playhead)` + `detectJam` every 250 ms in the rAF loop
    - _Requirements: 9.4_
  - [~] 11.3 Add the three Requirement 10.1 lines to the Assumptions; README Status: tick Spec 2 and add "battery and charging were cut on purpose; chargers are drawn and unused"
    - _Requirements: 10.1, 10.2_
  - [~] 11.4 Write `jamBadgeText` examples in `tests/jam.test.ts` (null gives `HEALTHY`; a jam gives `JAM DETECTED · ONSET T=… · SEVERITY …%` with alert)
    - _Requirements: 9.2_
  - [~] 11.5 Visible check and commit: in `npm run dev`, `pd-holder-freeze` shows `JAM DETECTED` with an onset, playback stays smooth at 16×. Commit "add telemetry panel and jam badge"

- [~] 12. Final checkpoint
  - Ensure `npm test`, `npm run lint`, and `npm run build` pass, including golden, healthy-baseline, jam, and oracle tests; ask the user if questions arise
  - Commit any remaining fixes: "fix final spec 2 checks" (skip if nothing changed)

## Notes

- No sub-tasks are optional.
- Property tests carry `// Feature: failures-telemetry, Property N: <title>`; run-level ones use `numRuns: 25` and 300 ticks, others `numRuns: 100`.
- Requirements 8 and 9 (UI) are checked visually in `npm run dev`; their pure helpers have unit tests.
- Spec 3 seams: `runHeadless`, `scoreFaults`, `generateScenarios`, and the disabled "Find the cause" button.
