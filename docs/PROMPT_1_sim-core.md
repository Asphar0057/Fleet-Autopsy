# PROMPT 1 — Fleet Autopsy: simulation core, layouts, renderer

Paste everything below the line into Kiro, in **Spec mode**, as the first prompt.
Before pasting: the repo already contains `.kiro/steering/{product,tech,design}.md` and `public/layouts/*` from this kickoff folder.

---

## Context

Fleet Autopsy is a browser app for a hackathon Robotics track. Judges review it asynchronously: they see only the GitHub repo, a video of at most 3 minutes, and a live link. Nobody presents it, so it must explain itself in 30 seconds.

The finished product (Specs 1 to 4) is a deterministic simulator of a warehouse robot fleet. When a traffic jam happens, one click ("Find the cause") replays alternate timelines to identify the root cause and verify a fix.

**This prompt is Spec 1 of 4.** Spec 2 adds failure injection, telemetry, and battery/charging. Spec 3 is the diagnosis engine, and Spec 4 the autopsy UI and AI report. Do NOT implement Specs 2 to 4 now. Leave clean seams for them, listed below.

Read the three steering files first. Follow them.

## Goal of this spec

Open the app and see a seeded fleet of robots moving through a warehouse layout, collision-free and deadlock-free at the recommended fleet size, delivering pods to stations, with a replay scrubber, live metrics, a verifier badge, and the visual design from `design.md`. All of it is covered by tests.

## Scope

**In:** layout loader, simulation core, PIBT movement with the station rules below, task cycle, recorder, verifier, metrics, Canvas renderer, playback UI, tests.
**Out:** failure injection, battery and charging (chargers are drawn but unused for now), diagnosis, AI calls, backend, 3D, physics, sketch upload, authentication.

## Requirements (turn these into EARS acceptance criteria; keep to 10 or fewer)

**R1. Layout loading.** Load `public/layouts/layouts.json` and the `.txt` grids it references. Legend: `#` wall, `.` floor, `p` pod slot, `S` station, `c` charger. Endpoints (`p`, `S`, `c`) can be entered only by a robot whose current goal is that cell, and are never traversed. Reject a layout whose floor is disconnected or whose endpoints have no reachable floor neighbor. Each station has exactly one floor neighbor, its **access cell**. Presets (all numbers are in the JSON):

| id | size | recommended robots | max robots | queue cap | stations | pods |
|---|---|---|---|---|---|---|
| pocket-dc | 24×11 | 9 | 12 | 6 | 2 | 48 |
| fulfillment-block | 39×23 | 36 | 45 | 8 | 6 | 288 |
| chokepoint | 35×22 | 22 | 28 | 8 | 3 | 120 |

The robot-count slider goes up to "max robots". Above that, jams are expected and acceptable.

**R2. Deterministic time.** Discrete ticks. Per tick each robot stays or moves one cell (4-neighborhood). All randomness comes from a seeded PRNG (mulberry32). The same layout, config, and seed always produce a byte-identical recording. `src/sim` never touches the DOM, `Math.random`, or `Date.now`.

**R3. Movement (PIBT) with three mandatory rules.** Implement Priority Inheritance with Backtracking (Okumura et al.). Each tick, robots are processed by priority. A robot's priority grows each tick it has not reached its goal and resets to zero when it does, with ties broken by id. A robot picks the neighbor that minimizes distance to its goal. If that cell is occupied by a robot that has not decided yet, the occupant inherits priority and must move elsewhere (never into the cell of the robot that pushed it), recursively, with backtracking on failure. Never allow two robots in one cell, or two robots swapping cells.
Mandatory rules (a prototype of this model deadlocked or livelocked without each of them):
- **(a) Blocked-aware distance maps.** BFS distance maps per goal must treat every station's access cell as blocked, except the access cell of the robot's own target station. Cache by (goal, allowed access cell). Without this, robots oscillate forever in front of cells they may not enter.
- **(b) Yielding priority.** Robots waiting in a station queue who do not hold the station reservation, and robots with no admissible task, get the lowest priority so everyone else can push them aside.
- **(c) Pinned robots.** A robot being served at a station cannot be pushed and cannot move. Reserve its cell before processing the others.

**R4. Task cycle, admission, and station reservation.**
- **Task start:** a robot picks an unreserved random pod and, at the same time, a station minimizing BFS distance from the pod's floor neighbor plus 3 times (queued + pending robots for that station). A station's queued + pending count may not exceed its queue cap. If no station has room, the robot waits (idle, lowest priority) and retries every tick.
- **Cycle:** go to the pod, pick it (instant), go to the station, be served for 8 to 14 ticks (seeded), return the pod to its own slot, start the next task. A pod slot is reserved for its robot while the pod is away.
- **Reservation:** each station has one reservation holder at a time, chosen from its queued robots as the one nearest (BFS) to the access cell when the station becomes free. Only the holder may stand on the access cell or the station cell.
- **Hand-off:** the reservation passes to the next holder only after the departing robot has left both the station cell and the access cell. Handing it over earlier produces head-on deadlocks in the one-cell station notch.

**R5. Chargers.** Draw chargers, but they are unused in this spec. Battery and charging arrive in Spec 2 under the same reservation rule.

**R6. Recording.** Record per tick: every robot's cell index (Int16Array, tick-major), robot state (to-pod, to-station, serving, returning, idle), and events (pick, deliver, service-start, service-end, stall). A stall event fires when a robot, outside service and idle-for-admission, has not moved for 200 ticks. Recording must support random-access playback to any tick.

**R7. Verifier.** `verifyRun(recording, layout)` returns a list of violations: same-cell, swap, move longer than one cell, robot on an illegal cell. The UI shows a badge: "VERIFIED · 0 VIOLATIONS · N TICKS" or the violation count in the accent color.

**R8. Metrics.** Throughput as deliveries in the trailing 100 ticks; mean cycle time (task start to service end); per-station queue length; per-cell wait counts for a congestion heat layer.

**R9. Renderer and UI.** Canvas 2D, DPR-aware, fits its container. Draw exactly as `design.md` specifies. Controls: layout switcher (3 presets), robot-count slider, seed input, play/pause, speed (1×, 4×, 16×), step, scrubber across recorded ticks, congestion-layer toggle, trail toggle. A right-hand panel shows the verifier badge, metrics, and a throughput sparkline. Keyboard: space to play/pause, arrow keys to step.

**R10. Performance.** A headless 1,000-tick run with 36 robots should complete in about 1.5 seconds or less on a laptop, because Spec 3 will run hundreds of replays in a web worker. Design for that: typed arrays, no per-tick object allocation in hot loops, no global state. Log timing in a test; do not fail on it.

## Expected healthy behavior (from a throwaway Python prototype of exactly these rules)

Over 5 seeds × 2,000 ticks at the recommended counts there were 0 violations, every robot completed deliveries, and no moving robot idled more than about 155 ticks. Throughput in deliveries per 100 ticks:

| preset | at recommended | at max |
|---|---|---|
| pocket-dc | about 13 | about 13 |
| fulfillment-block | about 38 | about 39 (plateaus from about 36 robots) |
| chokepoint | about 17 | about 19 |

Your numbers need not match, but below half of these suggests a bug. Past max robots the prototype jammed, which is realistic and is what Specs 2 to 4 will diagnose.

## Seams to leave for later specs (stubs only)

- `SimConfig` includes `faults: FaultEvent[]`, an empty array for now. The sim must be re-runnable from tick 0 with a different `faults` array and the same seed.
- The recording is enough to derive per-robot position per tick, state, station occupancy, and task events.
- The sim is a pure module with a single `createSim(layout, config)` entry and `step()`. It never reads UI state.

## Structure

```
src/sim/      types.ts rng.ts layout.ts distance.ts pibt.ts sim.ts recorder.ts verify.ts metrics.ts
src/render/   canvasRenderer.ts
src/ui/       App.tsx Controls.tsx Panel.tsx Scrubber.tsx
src/styles/   tokens.css base.css
tests/        determinism.test.ts verify.test.ts layout.test.ts pibt.test.ts health.test.ts perf.test.ts
public/layouts/  (provided)
```

## Tests required

1. Same seed gives an identical recording hash; a different seed gives a different one.
2. The verifier flags a hand-built same-cell violation and a hand-built swap.
3. All three presets load, are connected, and every endpoint is reachable.
4. PIBT: two robots meeting head-on in a one-cell-wide aisle with a side pocket resolve without a swap or a same-cell move.
5. Health: for each preset at its recommended robot count and queue cap, seeds 1 to 3, 2,000 ticks: 0 violations, every robot completes at least one delivery, and no robot outside service or admission-wait is idle for more than 200 ticks.
6. A hand-built station case: a robot leaving a station and the next holder arriving at the access cell do not deadlock.
7. A perf smoke test logs the headless timing.

## How to work

- Ask no questions. Where something is ambiguous, choose the simplest option and note it in `design.md`.
- Keep spec documents concise. At most 12 tasks. Each task is small enough to implement in one pass and ends with a test or a visible check.
- Do not add features that are not listed here.
- Use the stack in `tech.md`. Commit after each task with a clear message.

## Definition of done

`npm run dev` shows the fulfillment-block layout running with 36 robots, the verifier badge reads 0 violations, metrics update live, the scrubber works, and `npm test` passes, including the health test.
