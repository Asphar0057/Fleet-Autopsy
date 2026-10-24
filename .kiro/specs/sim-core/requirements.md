# Requirements Document: Simulation Core (Spec 1 of 4)

## Introduction

Fleet Autopsy is a browser-based, deterministic simulator of a warehouse robot fleet. This spec delivers the simulation core: layout loading, tick-based PIBT movement with station rules, the pod task cycle, a recorder, a verifier, metrics, a Canvas renderer, and playback UI. Failure injection, battery and charging, diagnosis, AI calls, and any backend belong to Specs 2 to 4 or are out of scope. Results are validated in simulation only.

Source of truth: `docs/PROMPT_1_sim-core.md`. Visual rules: `.kiro/steering/design.md`.

## Glossary

- **Sim**: The pure simulation module created by `createSim(layout, config)` and advanced with `step()`.
- **SimConfig**: `{ seed, robots, queueCap, faults }`. `faults` is a `FaultEvent[]`, empty in this spec.
- **Layout**: A parsed warehouse grid with cell kinds, neighbor tables, and station access cells.
- **Layout_Loader**: Parses `layouts.json` and grid text into a validated Layout.
- **Layout_Printer**: Formats a Layout back into grid text.
- **Endpoint**: A pod slot (`p`), station (`S`), or charger (`c`) cell.
- **Access_Cell**: The single floor neighbor of a station.
- **Robot**: A mobile unit with state idle, to-pod, to-station, serving, or returning.
- **Tick**: One discrete time step. Each robot stays or moves one cell in the 4-neighborhood.
- **Planner**: The PIBT (Priority Inheritance with Backtracking) move planner.
- **Distance_Cache**: BFS distance maps cached by (goal, allowed access cell).
- **Reservation_Holder**: The one robot per station allowed on that station's Access_Cell and station cell.
- **Queue_Cap**: Maximum of queued plus pending robots per station.
- **Recorder**: Writes ticks and events into a Recording.
- **Recording**: Per-tick robot cells and states, plus an event list.
- **Verifier**: `verifyRun(recording, layout)`; returns a list of Violations.
- **Violation**: A same-cell, swap, jump, or illegal-cell finding with tick and robot ids.
- **Metrics**: Pure functions deriving throughput, mean cycle time, queue lengths, and wait counts from a Recording.
- **Stall**: A robot, outside serving and idle-for-admission, that has not moved for 200 consecutive ticks.
- **Renderer**: The Canvas 2D drawing module.
- **UI**: The React app (header, controls, panel, scrubber).
- **Accent_Color**: `#ff4a1c`.

## Requirements

### Requirement 1: Layout loading

**User Story:** As an operator, I want layouts loaded and validated from files, so that the fleet only runs on layouts it can traverse.

#### Acceptance Criteria

1. WHEN `layouts.json` and a referenced grid file are supplied, THE Layout_Loader SHALL produce a Layout using the legend `#` wall, `.` floor, `p` pod slot, `S` station, `c` charger.
2. WHEN the three presets pocket-dc, fulfillment-block, and chokepoint are loaded, THE Layout_Loader SHALL expose the width, height, recommended robots, max robots, queue cap, and counts given in `layouts.json`.
3. IF the floor cells of a grid are not one connected region, THEN THE Layout_Loader SHALL reject the layout with a descriptive error.
4. IF a pod slot, station, or charger has no floor neighbor, THEN THE Layout_Loader SHALL reject the layout with a descriptive error.
5. IF a station does not have exactly one floor neighbor, THEN THE Layout_Loader SHALL reject the layout with a descriptive error.
6. THE Layout_Loader SHALL record the Access_Cell of each station.
7. THE Layout_Printer SHALL format a Layout into grid text.
8. FOR ALL valid grids, parsing then printing then parsing SHALL produce an equivalent Layout (round-trip property).
9. THE Renderer SHALL draw chargers as hollow squares with a plus symbol following design.md.

### Requirement 2: Deterministic time

**User Story:** As a developer, I want identical runs from identical inputs, so that later specs can replay alternate timelines exactly.

#### Acceptance Criteria

1. THE Sim SHALL advance in discrete Ticks, and in each Tick each Robot SHALL stay or move to one 4-neighbor cell.
2. THE Sim SHALL draw all randomness from a mulberry32 PRNG seeded by `SimConfig.seed`.
3. WHEN the same layout, SimConfig, and seed are run twice, THE Sim SHALL produce Recordings with identical hashes.
4. WHEN two runs differ only in seed, THE Sim SHALL produce Recordings with different hashes.
5. THE Sim SHALL expose a single `createSim(layout, config)` entry whose instance provides `step()` and owns all of its state.
6. THE Sim SHALL accept `SimConfig.faults` as an empty `FaultEvent[]` and be re-runnable from Tick 0 with the same seed and a different `faults` array.
7. THE `src/sim` module SHALL contain no references to the DOM, `Math.random`, `Date.now`, `performance.now`, `crypto.getRandomValues`, or imports from `src/ui` or `src/render`.
8. THE Sim SHALL iterate robots by id and cells by index when making decisions.

### Requirement 3: PIBT movement with mandatory rules

**User Story:** As an operator, I want collision-free, deadlock-free fleet movement, so that traffic jams come from causes and not from planner bugs.

#### Acceptance Criteria

1. WHEN a Tick is planned, THE Planner SHALL process Robots by priority, with ties broken by lower id.
2. THE Planner SHALL increase a Robot's priority by one each Tick the Robot has not reached its goal, and reset the priority to zero when the Robot reaches its goal.
3. WHEN the preferred neighbor of a Robot is occupied by a Robot that has not yet decided, THE Planner SHALL give the occupant the pusher's priority, require the occupant to move to a cell other than the pusher's cell, and backtrack to the next candidate if the occupant cannot move.
4. THE Planner SHALL produce moves in which no two Robots share a cell and no two Robots swap cells.
5. THE Planner SHALL permit a Robot to enter an Endpoint only when that Endpoint is the Robot's current goal, and SHALL never route a path through an Endpoint.
6. THE Distance_Cache SHALL compute BFS distances that treat every station Access_Cell as blocked, except the Access_Cell of the Robot's own target station, and SHALL cache by (goal, allowed access cell).
7. WHILE a Robot waits in a station queue without holding the reservation, THE Planner SHALL give the Robot the lowest priority tier.
8. WHILE a Robot has no admissible task, THE Planner SHALL give the Robot the lowest priority tier.
9. WHILE a Robot is serving at a station, THE Planner SHALL reserve the Robot's cell before processing other Robots, and the Robot SHALL neither move nor be pushed.
10. WHEN two Robots meet head-on in a one-cell-wide aisle that has a side pocket, THE Planner SHALL resolve the encounter without a swap or a shared cell.

### Requirement 4: Task cycle, admission, and station reservation

**User Story:** As an operator, I want robots to fetch pods, deliver them to stations, and return them, so that the fleet produces steady throughput.

#### Acceptance Criteria

1. WHEN a Robot starts a task and at least one station has queued plus pending below the Queue_Cap, THE Sim SHALL select an unreserved pod chosen with the seeded PRNG and, at the same time, the station minimizing BFS distance from the pod's floor neighbor to that station's Access_Cell plus 3 times (queued + pending) for that station.
2. IF every station has queued plus pending at or above the Queue_Cap, THEN THE Sim SHALL keep the Robot idle at lowest priority and retry task selection every Tick.
3. THE Sim SHALL move each Robot through the cycle: go to pod, pick (instant), go to station, be served for a seeded duration of 8 to 14 ticks inclusive, return the pod to its own slot, then start the next task.
4. WHILE a pod is away from its slot, THE Sim SHALL keep that pod slot reserved for the carrying Robot.
5. WHEN a station becomes free, THE Sim SHALL choose as Reservation_Holder the queued Robot nearest by BFS to the Access_Cell, with ties broken by lower id.
6. THE Sim SHALL allow only the Reservation_Holder to stand on a station's Access_Cell or station cell.
7. WHEN the departing Robot has left both the station cell and the Access_Cell, THE Sim SHALL pass the reservation to the next Reservation_Holder, and not before.
8. THE Sim SHALL compute no battery or charging behavior, and chargers SHALL remain unused.

### Requirement 5: Recording and stall events

**User Story:** As a developer, I want a compact recording with random access, so that the UI scrubber and later replays can read any tick.

#### Acceptance Criteria

1. THE Recorder SHALL store every Robot's cell index per tick in an Int16Array in tick-major order.
2. THE Recorder SHALL store every Robot's state per tick, using the states to-pod, to-station, serving, returning, and idle.
3. THE Recorder SHALL store events with tick, robot id, and kind, where kind is pick, deliver, service-start, service-end, or stall.
4. WHEN a Robot outside serving and outside idle-for-admission has not moved for 200 consecutive ticks, THE Recorder SHALL emit one stall event for that Robot.
5. WHEN a tick index within the recorded range is requested, THE Recording SHALL return the positions and states of all Robots at that tick without replaying the simulation.
6. THE Recording SHALL provide a deterministic hash over its positions, states, and events.

### Requirement 6: Verifier

**User Story:** As an operator, I want an independent check of every run, so that I can trust the recording.

#### Acceptance Criteria

1. WHEN two Robots occupy the same cell in one tick, THE Verifier SHALL report a same-cell Violation with tick and robot ids.
2. WHEN two Robots exchange cells between consecutive ticks, THE Verifier SHALL report a swap Violation with tick and robot ids.
3. WHEN a Robot moves more than one cell between consecutive ticks, THE Verifier SHALL report a jump Violation with tick and robot id.
4. WHEN a Robot occupies a wall cell or an Endpoint that is not that Robot's goal, THE Verifier SHALL report an illegal-cell Violation with tick and robot id.
5. WHEN a Recording contains no Violations, THE UI SHALL show the badge text `VERIFIED · 0 VIOLATIONS · N TICKS`, where N is the recorded tick count.
6. IF a Recording contains one or more Violations, THEN THE UI SHALL show the Violation count in the badge using the Accent_Color for text and border.

### Requirement 7: Metrics

**User Story:** As an operator, I want live fleet metrics, so that I can see how well the fleet performs.

#### Acceptance Criteria

1. THE Metrics SHALL compute throughput at tick T as the number of deliver events in ticks (T - 100, T].
2. THE Metrics SHALL compute mean cycle time as the mean of (service-end tick minus task-start tick) over completed services up to tick T.
3. THE Metrics SHALL compute the queue length of each station at tick T.
4. THE Metrics SHALL compute, for each floor cell, the count of ticks up to T in which a Robot stayed on that cell while not serving and not idle-for-admission.
5. WHEN the UI advances or seeks to a tick, THE UI SHALL display the Metrics for that tick.

### Requirement 8: Renderer

**User Story:** As a viewer, I want a blueprint-style warehouse view, so that the fleet state is readable at a glance.

#### Acceptance Criteria

1. THE Renderer SHALL draw to a Canvas 2D context scaled by the device pixel ratio and sized to fit its container.
2. THE Renderer SHALL draw walls as 1.4px black edges only between a wall cell and a non-wall cell, with square caps and no cell fill.
3. THE Renderer SHALL draw pod slots as hollow 1px black squares inset 2.5px, stations as solid black squares with the station number in white mono, and chargers as hollow squares with a small plus.
4. THE Renderer SHALL draw each Robot as a solid black dot of radius 0.27 cell, and add a 1px ring of radius 0.42 cell while the Robot carries a pod.
5. WHERE the trail toggle is on, THE Renderer SHALL draw the last 12 ticks of each Robot as a 1px black polyline with fading opacity.
6. WHERE the congestion toggle is on, THE Renderer SHALL draw diagonal black hatching at about 45° with 0.6px lines whose density grows with the cell wait count.
7. WHEN a stall event is active for a Robot, THE Renderer SHALL draw an Accent_Color ring of radius about 0.78 cell and a mono label of the form `R17 · STALL`.
8. THE Renderer SHALL use the Accent_Color for no purpose other than a stall, a violation, or a root-cause highlight.

### Requirement 9: Playback UI

**User Story:** As a viewer, I want to run, scrub, and configure the simulation, so that I can explore a run without instructions.

#### Acceptance Criteria

1. WHEN the app starts, THE UI SHALL run the fulfillment-block layout with 36 robots and a default seed.
2. THE UI SHALL provide a layout switcher for the three presets, a robot-count slider up to the layout's max robots, a seed input, play/pause, speed buttons for 1×, 4×, and 16×, a step control, a scrubber across recorded ticks, a congestion toggle, and a trail toggle.
3. WHEN the layout, robot count, or seed changes, THE UI SHALL create a new Sim and restart from tick 0.
4. WHEN the user drags the scrubber, THE UI SHALL render the Recording at the chosen tick without advancing the Sim.
5. WHEN the user presses space, THE UI SHALL toggle play and pause, and WHEN the user presses the left or right arrow key, THE UI SHALL step one tick back or forward.
6. THE UI SHALL render a right-hand panel containing the verifier badge, the Metrics, and a throughput sparkline.
7. THE UI SHALL implement controls as real buttons, with `aria-label` on icon-only controls.
8. WHILE the user prefers reduced motion, THE UI SHALL disable non-essential transitions.
9. THE UI SHALL show the assumptions text "validated in simulation only" in the panel.

### Requirement 10: Health and performance

**User Story:** As a developer, I want automated proof that the fleet is healthy and fast, so that later specs can build on it.

#### Acceptance Criteria

1. FOR ALL presets at the recommended robot count and queue cap, with seeds 1 to 3 over 2,000 ticks, THE Verifier SHALL report zero Violations.
2. FOR ALL presets at the recommended robot count and queue cap, with seeds 1 to 3 over 2,000 ticks, every Robot SHALL complete at least one delivery.
3. FOR ALL presets at the recommended robot count and queue cap, with seeds 1 to 3 over 2,000 ticks, no Robot outside serving and idle-for-admission SHALL go more than 200 ticks without moving.
4. THE Sim SHALL run 1,000 headless ticks with 36 robots on fulfillment-block in about 1.5 seconds or less on a laptop, and the performance test SHALL log the measured time without failing on it.
5. THE Sim SHALL use typed arrays for positions, priorities, and distance maps, and SHALL allocate no objects per Tick in hot loops.
