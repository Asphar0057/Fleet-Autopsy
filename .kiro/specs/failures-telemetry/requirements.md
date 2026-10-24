# Requirements Document: Failures, Telemetry, Jam Detection (Spec 2 of 4)

## Introduction

Spec 2 adds fault injection to the deterministic sim, curated and generated failure scenarios with verified ground truth, telemetry derived only from a Recording, a jam detector, and the UI to pick a scenario, watch it degrade, see the jam detected, and optionally reveal the ground truth. Battery and charging are cut on purpose. Diagnosis, counterfactual search, baselines, and AI belong to Specs 3 and 4; this spec leaves their seams (`runHeadless`, `scoreFaults`, `generateScenarios`, a disabled "Find the cause" button). Fault-free runs keep Spec 1 behavior and recording hashes. Results are validated in simulation only.

## Glossary

- **Sim, Recording, Verifier, Layout, Planner, Distance_Cache, Reservation_Holder, Access_Cell, Tick, Stall**: as in `.kiro/specs/sim-core/requirements.md`.
- **Fault**: one `FaultEvent`, a discriminated union of `robot-freeze`, `station-slowdown`, `blocked-cell`, `slow-robot`. All fields are plain numbers; `duration: null` is permanent.
- **Fault_Window**: ticks `t` with `fault.tick <= t < fault.tick + duration` (unbounded when permanent). Tick `t` is the frame index the step produces.
- **Pinned**: a robot that stays this tick and cannot be pushed by the Planner.
- **Engaged_Block**: a blocked-cell Fault from the first tick of its window at whose start the cell is empty, until the window ends.
- **Telemetry**: signals derived by `deriveTelemetry` / `createTelemetryTracker` from a Recording and Layout only.
- **Standstill**: for a robot at tick t, the number of consecutive frames ending at t in which the robot did not move and was neither serving nor idle.
- **Baseline**: at tick t, the median of trailing-100 throughput over ticks 150 to t − 100; defined only when that range holds at least 100 ticks (t ≥ 349), so a fault at tick 300 is detectable.
- **Jam_Detector**: `detectJam(rec, layout, upToTick)`.
- **Scenario**: `{ id, name, layoutId, seed, robots, faults, groundTruth: { primaryFaultIndex, decoyIndices } }`.
- **Oracle**: `scoreFaults(layout, config)`.
- **Recovered_Fraction**: for a fault, (deliveries in ticks 0 to 2,000 without that fault − deliveries with all faults) ÷ (fault-free deliveries − deliveries with all faults).
- **Generator**: `generateScenarios(layout, seed, count)`.
- **UI**: the React app from Spec 1.
- **Accent_Color**: `#ff4a1c`.

## Requirements

### Requirement 1: Fault model and effects

**User Story:** As a developer, I want typed, deterministic faults, so that scenarios reproduce exactly and Spec 3 can replay any subset.

#### Acceptance Criteria

1. THE Sim SHALL apply each Fault at the start of the tick it names and keep it active for its Fault_Window.
2. WHILE a robot-freeze Fault is active, THE Sim SHALL treat the robot as Pinned and pause its task timers.
3. WHEN a service starts while a station-slowdown Fault on that station is active, THE Sim SHALL multiply the drawn service duration by the Fault's integer factor (2 to 4).
4. WHILE a blocked-cell Fault is an Engaged_Block, THE Planner SHALL treat the cell as impassable and THE Distance_Cache SHALL exclude it, recomputing maps only when the set of engaged blocks changes.
5. WHILE a slow-robot Fault is active, THE Sim SHALL treat the robot as Pinned on every tick where `tick % period != 0` (period 2 to 4).
6. IF a blocked-cell Fault names a cell that is not plain floor, is a station Access_Cell, whose removal disconnects the floor, or whose removal leaves any pod, station, or charger without a floor neighbor, THEN THE Sim SHALL throw a descriptive error at creation.
7. WHILE any block is engaged, THE Sim SHALL select in the task phase only pods that have at least one reachable, unblocked floor neighbor.
8. WHEN the same layout, seed, robots, queue cap, and faults are run, THE Sim SHALL produce Recordings with identical hashes, and a run whose faults array has a fault removed SHALL equal a run created without that fault.
9. WHEN the faults array is empty, THE Sim SHALL produce the same Recording hash as Spec 1 for the same inputs.

### Requirement 2: Verifier under faults

**User Story:** As an operator, I want faulted runs checked by the same independent verifier, so that jams come from faults and not from bugs.

#### Acceptance Criteria

1. WHEN `verifyRun(rec, layout, faults)` is given faults, THE Verifier SHALL report a `blocked-cell` Violation for every frame in which a robot stands on an Engaged_Block.
2. THE Verifier SHALL keep the same-cell, swap, jump, and illegal-cell rules unchanged, and SHALL behave as in Spec 1 when faults are omitted.
3. FOR ALL curated Scenarios over 2,000 ticks, THE Verifier SHALL report zero Violations.

### Requirement 3: Telemetry from observable signals

**User Story:** As an operator, I want telemetry that a real fleet could report, so that detection does not cheat by reading the faults.

#### Acceptance Criteria

1. THE Telemetry SHALL be computed from a Recording and Layout only, with no access to faults or Sim internals.
2. THE Telemetry SHALL provide per tick: trailing-100 throughput, per-station queue length, the count of robots with Standstill of at least 20, and the count with Standstill of at least 100.
3. THE Telemetry SHALL provide at the query tick: each robot's Standstill, each station's mean observed service duration over its last 5 completions, each station's completions in the trailing 100 ticks, and per-cell wait counts as in Spec 1.
4. THE Telemetry SHALL expose a pure `deriveTelemetry(rec, layout, upToTick)` and an incremental `createTelemetryTracker`, and both SHALL return equal results for the same tick.
5. THE Telemetry SHALL derive 2,000 ticks for 45 robots in under 100 ms on a laptop (logged, not asserted).

### Requirement 4: Jam detector

**User Story:** As an operator, I want an automatic jam alarm with an onset tick, so that I know when the fleet started to degrade.

#### Acceptance Criteria

1. WHEN trailing throughput stays below 60% of the Baseline (median over ticks 150 to t − 100, at least 100 ticks) for 40 consecutive ticks, THE Jam_Detector SHALL declare a jam with signal `throughput`.
2. WHEN 3 or more robots have a Standstill of at least 100 ticks, THE Jam_Detector SHALL declare a jam with signal `standstill`.
3. WHEN a jam is declared, THE Jam_Detector SHALL return `{ onsetTick, detectedTick, severity, signals }`, where onsetTick is the last tick before the drop at which throughput was at least 90% of the Baseline, and otherwise return null.
4. FOR ALL 15 healthy baselines (3 presets at recommended robots, seeds 1 to 5, 2,000 ticks), THE Jam_Detector SHALL return null. If the trailing-100 window gives a false alarm on a healthy baseline for a small layout, use a 200-tick window for layouts with under 20 deliveries per 100 ticks, never a looser percentage; record the choice in design.md and the Assumptions text.
5. FOR ALL curated Scenarios, THE Jam_Detector SHALL report detectedTick within 200 ticks after the primary fault tick.
6. WHEN the decoy-first Scenario is evaluated, THE Jam_Detector SHALL report an onsetTick closer to the primary fault tick than to the decoy fault tick.

### Requirement 5: Curated scenarios

**User Story:** As a viewer, I want named failure scenarios, so that I can watch typical jams develop.

#### Acceptance Criteria

1. THE Sim module SHALL export at least 6 curated Scenarios, each oracle-verified (Requirement 6.2) and detected within 200 ticks (Requirement 4.5), covering the structures fulfillment-block, chokepoint, and pocket-dc, plus a decoy-first two-fault scenario; at least 2 per layout is preferred. The curated set is: a frozen robot in a one-cell aisle and a factor-4 slowdown on the busiest station at the layout's maximum robot count (fulfillment-block); a frozen robot in each of the two doors (chokepoint); a frozen Reservation_Holder and the decoy-first scenario (pocket-dc).
2. WHERE a Scenario has a decoy, THE Scenario SHALL list the decoy fault with an earlier tick than the primary fault.
3. FOR ALL curated Scenarios, THE Oracle SHALL confirm the ground truth (Requirement 6.2).

### Requirement 6: Oracle and generator

**User Story:** As a Spec 3 developer, I want verified ground truth and a deterministic scenario source, so that the diagnosis engine can be benchmarked.

#### Acceptance Criteria

1. WHEN `scoreFaults(layout, config)` is called, THE Oracle SHALL run 2,000 ticks fault-free, with all faults, and once per fault with that fault removed, and return each fault's Recovered_Fraction.
2. THE Oracle SHALL deem a Scenario valid when all faults cost at least 10% of fault-free deliveries, the primary fault's Recovered_Fraction is at least 0.7, and every decoy's is below 0.1.
3. WHEN `generateScenarios(layout, seed, count)` is called, THE Generator SHALL return `count` valid Scenarios by seeded rejection sampling over fault kind, target, and fault tick in [300, 700].
4. IF the Generator does not find `count` valid Scenarios within its attempt bound, THEN THE Generator SHALL throw an error naming the layout, seed, and attempts.
5. WHEN called twice with the same arguments, THE Generator SHALL return deeply equal results.

### Requirement 7: Headless replay seam

**User Story:** As a Spec 3 developer, I want a fast headless run, so that counterfactual replays are cheap.

#### Acceptance Criteria

1. THE Sim module SHALL export `runHeadless(layout, config, ticks)` returning a Recording with no UI work.
2. FOR ALL subsets and reorderings of a Scenario's faults, `runHeadless` SHALL be deterministic, and reorderings SHALL yield identical hashes.
3. THE perf test SHALL log the time of a faulted 2,000-tick fulfillment-block run at 36 robots (target about 0.5 s; not asserted).

### Requirement 8: Scenario UI and ground-truth reveal

**User Story:** As a viewer, I want to pick a scenario and optionally reveal its cause, so that the demo explains itself without spoiling the diagnosis.

#### Acceptance Criteria

1. THE UI SHALL provide a "Scenario" select with "Healthy" plus every curated Scenario.
2. WHEN a Scenario is chosen, THE UI SHALL create a new Sim with the Scenario's layout, seed, robots, and faults, and the layout switcher, robot slider, and seed input SHALL show those values.
3. WHILE ground truth is hidden, THE Renderer SHALL draw no fault markers or labels, and SHALL draw each Engaged_Block as a cross-hatched square.
4. WHEN the "Reveal ground truth" toggle (`aria-pressed`) is on, THE UI SHALL draw Accent_Color markers on each faulty robot, cell, or station, show a one-line mono legend, and mark fault ticks on the scrubber.
5. THE UI SHALL keep every new control reachable and operable by keyboard.

### Requirement 9: Telemetry panel and jam badge

**User Story:** As an operator, I want live telemetry and a jam badge, so that I see the jam as the fleet sees it.

#### Acceptance Criteria

1. THE UI SHALL show a `03  TELEMETRY` panel section with a throughput sparkline, per-station queue bars, and the count of robots with Standstill of at least 20.
2. WHEN a jam is detected up to the playhead, THE UI SHALL show the badge `JAM DETECTED · ONSET T=<onset> · SEVERITY <n>%` in the Accent_Color and mark the onset on the sparkline in the Accent_Color; otherwise THE UI SHALL show `HEALTHY` in ink.
3. THE UI SHALL show a disabled primary button "Find the cause" with the caption "Available in the next step" below the badge.
4. THE UI SHALL run detection on the Recording up to the playhead at most about 4 times per second using the incremental tracker.

### Requirement 10: Honesty and README

**User Story:** As a judge, I want stated assumptions, so that I can trust what the demo claims.

#### Acceptance Criteria

1. THE UI Assumptions section SHALL state: simulation only; faults are injected with known ground truth; detection thresholds are fixed and were not tuned on the evaluation scenarios beyond the healthy baselines.
2. THE README Status SHALL tick Spec 2 and state that battery and charging were cut on purpose.
