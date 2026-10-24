# Fleet-Autopsy
Deterministic warehouse-fleet simulator that finds why a robot traffic jam happened. Replays alternate timelines to isolate the root cause and verify a fix. Simulation only.

## Status

- [x] Spec 1: simulation core, layouts, renderer
- [x] Spec 2: failure injection with ground truth, telemetry, jam detection, curated scenarios
  - battery and charging were cut on purpose; chargers are drawn and unused
- [ ] Spec 3: diagnosis engine (abduction by simulation, counterfactual replay)
- [ ] Spec 4: autopsy UI, AI-written report, verified fix

## Run it

```
npm install
npm run dev     # local app, opens fulfillment-block with 36 robots
npm test        # vitest, includes property-based and health tests
npm run build   # typecheck and static production build
```

## How Kiro was used

- The prompt (`docs/PROMPT_1_sim-core.md`), the steering files (`.kiro/steering/`) and the three layout grids (`public/layouts/`) were drafted beforehand with Claude.
- Kiro Spec mode generated `requirements.md`, `design.md` and `tasks.md` in `.kiro/specs/sim-core/` from them. The spec was reviewed and adjusted before implementation (for example, the health test was moved earlier as a gate).
- Kiro implemented the tasks one at a time, each with tests (unit, example and property-based with fast-check) and its own commit.
- Kiro features used: specs and steering.
- Things Kiro changed on its own while implementing:
  - Planner: added a corridor swap step (from Okumura, "Engineering LaCAM*", 2024). Plain PIBT failed 40 of 50 head-on cases in a one-cell aisle. The higher-priority robot now backs up toward a branch and the other robot takes the freed cell. Robots never exchange cells in one tick.
  - Station reservation: the sim tracks the reservation holder directly. This fixes a case the Python prototype misses, where a robot whose pod slot sits next to an access cell delivers before release runs and the station stays reserved forever.

## Limits

- Mild faults mostly go undetected. A blocked door while the second door is open, or a slow robot in a storage aisle, cost at most about 13% (door) and 7% (slow robot) of deliveries in our sweep (chokepoint, 28 robots, seeds 1 to 10), because the fleet routes around them. That is below the jam detector's thresholds, so it did not fire on any of them. A slowed station is caught only in the heaviest case we tried: factor 4 on the busiest station at 45 robots on fulfillment-block (10.2% loss, detected 109 ticks after the slowdown starts, when three robots have waited 100 ticks in its queue). This is a real limit of the detector.
- The curated scenarios therefore use high-impact faults (a robot frozen in an aisle, a door, or on a station), plus that one station slowdown. Each is checked by re-running without the fault (simulation only).

Results are validated in simulation only. Inspired by fulfillment-center drive-unit systems; no affiliation with any company.
