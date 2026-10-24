# Fleet-Autopsy
Deterministic warehouse-fleet simulator that finds why a robot traffic jam happened. Replays alternate timelines to isolate the root cause and verify a fix. Simulation only.

## Status

- [x] Spec 1: simulation core, layouts, renderer
- [ ] Spec 2: failure injection, telemetry, battery and charging
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

Results are validated in simulation only. Inspired by fulfillment-center drive-unit systems; no affiliation with any company.
