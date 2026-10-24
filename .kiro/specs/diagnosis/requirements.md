# Requirements Document: Diagnosis Engine (Spec 3 of 4)

## Introduction

The diagnosis engine finds the root cause of a detected jam by counterfactual replay. It sees only what an operator sees: the layout, the seed, robot count and queue cap, and the Recording. It never sees the fault list. It infers candidate faults from observables, re-runs the deterministic sim with each candidate, and ranks candidates by how well the replay reproduces the observation. Two naive baselines, a sim-verified fix check, a benchmark with committed results, precomputed autopsies for the six curated scenarios, a Web Worker wrapper, and a `?debug=diagnose` dev readout complete the spec. Results are validated in simulation only. No UI beyond the dev readout, no AI, no backend, no battery.

## Glossary

- **Diagnoser**: the code in `src/diagnosis` that turns observables into a ranked diagnosis (`extractEvidence`, `generateHypotheses`, `scoreHypothesis`, `diagnose`).
- **Observed_Config**: `{ seed, robots, queueCap }` of a run, without faults.
- **World_Config**: the full `SimConfig` of a run, including the true faults. Only the Fix_Verifier and the Benchmark_Runner read it.
- **Jam**: output of the Spec 2 `detectJam` (`onsetTick`, `detectedTick`, `severity`, `signals`).
- **Evidence**: observables extracted from the Recording up to `jam.detectedTick`.
- **Hypothesis**: a candidate `FaultEvent` built from Evidence.
- **Target**: `{ kind, target }`, the fault kind plus its robot, station, or cell.
- **Observation_Window**: frames `0 .. endTick`, with `endTick = min(jam.detectedTick + 200, rec.frames − 1)`.
- **Similarity**: a score in [0, 1] comparing a replay to the observed Recording on the Observation_Window.
- **Baselines**: `blameFirstAlarm` and `blameMostSevere`.
- **Fix_Verifier**: `verifyFix` and `proposeFix`.
- **Benchmark_Runner**: `buildBenchmarkSet`, `runBenchmark`, and `npm run benchmark`.
- **Precompute_Script**: `npm run precompute`.
- **Worker_Client**: `diagnoseInWorker` and the worker entry.
- **Primary**: the ground-truth root-cause fault of a scenario.
- **Debug_Panel**: the `?debug=diagnose` dev readout in `src/diagnosis/DebugPanel.tsx`.

## Requirements

### Requirement 1: Evidence extraction

**User Story:** As an operator, I want the observable symptoms of a jam summarized, so that hypotheses come from data I can see.

#### Acceptance Criteria

1. WHEN `extractEvidence(rec, layout, jam)` is called, THE Diagnoser SHALL read only frames and events with tick ≤ `jam.detectedTick`.
2. THE Diagnoser SHALL return per-robot standstill start ticks and cells, the stalled robots in first-stalled order, past standstill episodes, per-cell wait hot-spots, per-station service-duration series and completion counts, and the throughput curve.
3. WHEN `extractEvidence` is called twice with equal inputs, THE Diagnoser SHALL return deep-equal Evidence made of plain JSON-safe values.

### Requirement 2: Hypothesis generation

**User Story:** As an engineer, I want candidate faults inferred from evidence alone, so that the diagnosis cannot cheat by reading the fault list.

#### Acceptance Criteria

1. WHEN `generateHypotheses(evidence, layout, config)` is called, THE Diagnoser SHALL emit a robot-freeze at the standstill start of each of the first 8 stalled robots, a station-slowdown for each station whose services rose 2x to 4x over its own early services, a blocked-cell for each busy cell robots stopped entering, and a slow-robot for each robot whose moves fall only on ticks divisible by a period in [2, 4].
2. THE Diagnoser SHALL infer every Hypothesis parameter (tick, duration, factor, period, cell) from Evidence.
3. THE Diagnoser SHALL return a deduplicated, deterministically ordered list of at most 40 Hypotheses, each accepted by `validateFaults`.
4. THE Diagnoser SHALL produce the same Hypotheses for any value of `config.faults`.
5. THE Diagnoser SHALL import only types from `src/sim/scenarios.ts`, enforced by ESLint.

### Requirement 3: Counterfactual scoring

**User Story:** As an engineer, I want each hypothesis tested by replay, so that the ranking rests on simulated evidence.

#### Acceptance Criteria

1. WHEN `scoreHypothesis(layout, config, hypothesis, observed, window, base)` is called, THE Diagnoser SHALL run `runHeadless` with the Observed_Config plus `base` plus the Hypothesis for `window.endTick` ticks.
2. THE Diagnoser SHALL return a Similarity in [0, 1] built from the per-robot position match rate (weighted toward ticks at or after the Hypothesis tick), the throughput curve error, and the per-station queue-length error.
3. WHEN the replay equals the observed Recording on the Observation_Window, THE Diagnoser SHALL return a Similarity of exactly 1.

### Requirement 4: Multi-fault diagnosis

**User Story:** As an operator, I want a ranked diagnosis with evidence and impact, so that I know what to fix first and why.

#### Acceptance Criteria

1. WHEN `diagnose(layout, config, rec, jam, options)` is called, THE Diagnoser SHALL select faults greedily: add the Hypothesis with the highest Similarity given the faults already selected, and stop when the best marginal gain is below 0.02 or 3 faults are selected.
2. THE Diagnoser SHALL return `{ rootCause, faults, hypotheses, evidence, replaysRun, elapsedMs }`, where `rootCause` is the selected fault whose removal from the selected set recovers the most deliveries, or null when no fault is selected.
3. THE Diagnoser SHALL give each ranked fault a score, marginal gain, impact in deliveries per 100 ticks, a confidence of high, medium, or low from fixed score gaps, and evidence strings built from numbers in Evidence and replay results.
4. WHEN `diagnose` is called twice with equal inputs, THE Diagnoser SHALL return deep-equal results apart from `elapsedMs`.

### Requirement 5: Naive baselines

**User Story:** As a judge, I want naive baselines, so that I can see what counterfactual replay adds.

#### Acceptance Criteria

1. WHEN `blameFirstAlarm(evidence)` is called, THE Baselines SHALL return the Target of the earliest anomaly: a robot standstill episode of at least 20 ticks or a station service longer than twice its early mean, starting at or after tick 150.
2. WHEN `blameMostSevere(evidence)` is called, THE Baselines SHALL return the Target of the anomaly with the most delay ticks.
3. WHEN `matchesGroundTruth(target, truth, layout)` is called, THE Baselines SHALL return true exactly when kinds are equal and targets are equal, or, for blocked-cell, the cells are equal or 4-adjacent.

### Requirement 6: Verified fix

**User Story:** As an operator, I want the proposed fix checked in simulation, so that I trust it before acting.

#### Acceptance Criteria

1. WHEN `verifyFix(layout, world, diagnosis, ticks = 2000)` is called, THE Fix_Verifier SHALL remove every World_Config fault matching the root cause, replay from tick 0, and return `{ fix, throughputBaseline, throughputBefore, throughputAfter, recoveredFraction, passed }`.
2. THE Fix_Verifier SHALL set `passed` exactly when `recoveredFraction` ≥ 0.7.
3. WHEN `proposeFix(fault, layout)` is called, THE Fix_Verifier SHALL return a fixed sentence per kind that names the robot, station, or cell.
4. THE Fix_Verifier SHALL label every result as sim-verified.

### Requirement 7: Benchmark

**User Story:** As a judge, I want an honest benchmark against ground truth, so that I can judge accuracy from numbers.

#### Acceptance Criteria

1. WHEN `npm run benchmark` runs, THE Benchmark_Runner SHALL build at least 60 valid scenarios with `generateScenarios` on all three layouts with seeds ≥ 1000, each as a decoy-first two-fault case and a single-fault primary-only case.
2. THE Benchmark_Runner SHALL run `detectJam`, `diagnose`, `blameFirstAlarm`, and `blameMostSevere` on each scenario and record whether each names the Primary, counting a scenario without a detection as not detected for every method.
3. THE Benchmark_Runner SHALL write `benchmark/results.json` and `benchmark/RESULTS.md` with accuracy and counts by fault kind and overall, the not-detected count, median replays and median ms per diagnosis, and each failed scenario with a reason code.
4. THE Diagnoser SHALL use constants tuned only on dev seeds 100 to 120, recorded in `design.md`.

### Requirement 8: Speed and non-blocking execution

**User Story:** As an operator, I want a diagnosis in seconds without freezing the tab, so that the tool feels usable.

#### Acceptance Criteria

1. THE Diagnoser SHALL replay at most the 12 Hypotheses with the highest cheap pre-score, on the Observation_Window.
2. WHILE `diagnose` runs, THE Diagnoser SHALL call `options.onProgress(done, total, current)` after each replay.
3. IF `options.signal` is aborted, THEN THE Diagnoser SHALL stop before the next replay and reject with an `AbortError`.
4. WHEN `diagnoseInWorker(request, options)` is called, THE Worker_Client SHALL run `diagnose` in a Web Worker, forward progress, and terminate the worker and reject with an `AbortError` on abort.

### Requirement 9: Precomputed autopsies and dev readout

**User Story:** As a Spec 4 developer, I want precomputed autopsies and a dev readout, so that the UI has an instant path and a fallback.

#### Acceptance Criteria

1. WHEN `npm run precompute` runs, THE Precompute_Script SHALL write `public/autopsies/<scenarioId>.json` for the 6 curated scenarios with the `diagnose` output (without `elapsedMs`) and the `verifyFix` output.
2. THE Precompute_Script SHALL write byte-identical files on repeated runs.
3. WHERE the URL has `?debug=diagnose`, THE Debug_Panel SHALL run `diagnoseInWorker` on the curated scenario chosen in its own select (initially `?scenario=<id>`, else the first curated scenario) and print the ranked faults and the verified fix.
4. THE Debug_Panel SHALL live in `src/diagnosis/DebugPanel.tsx` and be mounted by one added line in `src/main.tsx`, with no other change to `src/ui`.
