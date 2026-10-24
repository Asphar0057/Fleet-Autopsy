# Fleet Autopsy

A browser-based, deterministic simulator of a warehouse robot fleet. When traffic jams, one click ("Find the cause") replays alternate timelines to name the root cause, quantify its effect, and verify a fix. Simulation only: nothing here has been validated on a real fleet.

Inspired by fulfillment-center drive-unit systems; no affiliation with any company.

## Quickstart (30 seconds)

```
npm i
npm run dev
```

Open the local URL, enter the simulator, and click "Start with the decoy scenario". When the jam badge appears, click "Find the cause" and step through the autopsy.

Other commands: `npm test`, `npm run lint`, `npm run build`, `npm run benchmark`, `npm run precompute`.

## How it works

1. Simulate. A seeded, deterministic simulator moves robots between pod slots and pick stations on a grid, with a PIBT-style planner (priority inheritance, one cell per tick, no collisions; every run is checked by a verifier). Same seed, same run.
2. Inject a failure. Scenarios add faults (frozen robot, slowed station, blocked cell, slow robot) with known ground truth. Some scenarios add a decoy fault first.
3. Observe telemetry. Only what an operator could see is used: throughput, station queues, robots standing still.
4. Detect the jam. A fixed rule compares throughput with a healthy baseline and reports onset, detection tick and severity.
5. Diagnose by counterfactual replay. Candidate faults are built from the telemetry, each is injected alone into a replay from tick 0, and the replay that best matches the observed run is selected greedily as the root cause. Removing that fault from the true world in a final run verifies the fix, in simulation.

The UI walks through this in five steps: the alarm, suspects, counterfactual replay (observed run and replay side by side), root cause, verified fix. A deterministic template report summarises the autopsy from its data only.

## Benchmark

Held-out seeds 1000 and up, run once, nothing tuned on them: 60 scenarios, 120 cases (each scenario as the full world and as primary-only). In 49 cases no jam was detected, mostly mild station slowdowns; every method counts those as wrong. Full tables: [benchmark/RESULTS.md](benchmark/RESULTS.md).

| method | overall correct | among 71 detected jams |
| --- | --- | --- |
| replay diagnosis | 47/120 (39.2%) | 47/71 (66.2%) |
| blame the most severe | 56/120 (46.7%) | 56/71 (78.9%) |
| blame the first alarm | 3/120 (2.5%) | 3/71 (4.2%) |

- Replay diagnosis does not beat every baseline. Overall, "blame the most severe" is more accurate.
- Replay is better on single-fault jams (31/36, 86.1% vs 27/36, 75.0%) and is the only method that identifies station slowdowns (5 vs 0).
- It is worse than "most severe" on two-fault cases with a decoy (16/35, 45.7% vs 29/35, 82.9%).
- Dev-seed accuracy was 50.8%; held-out accuracy is 39.2%. The method did not generalise as well as the dev seeds suggested.
- "Blame the first alarm" is weak by construction: healthy robots often pause 20 ticks or more, so the first anomaly is usually noise.
- Median cost: 21 replays and 783 ms per diagnosis.
- The six curated scenarios in the app are hand-picked. All are diagnosed correctly with a passing verified fix, so they are a demo, not representative accuracy.

## How Kiro was used

- Kiro IDE throughout.
- Spec mode for the simulator core, failure injection and telemetry, the diagnosis engine, and the visual redesign (`.kiro/specs/`).
- Steering files (product, tech, design in `.kiro/steering/`) enforcing determinism rules (also linted) and the design system.
- Autopilot with trusted commands.
- fast-check property tests and golden-hash tests to keep the simulator deterministic.
- A bounded debug protocol: after two failed attempts, write it up in `docs/spec*-debug.md` and move on.
- Parallel Kiro windows on git worktrees (for example the design branch next to the diagnosis work).
- Vibe mode for polish and the autopsy UI.

What the author did or corrected: wrote the steering files and kickoff prompts; removed an infeasible baseline definition from a spec; rejected an overclaiming line in the video hook; replaced three planned scenarios after the detector could not see mild faults.

Not used: hooks, MCP, powers, CLI.

## Limits

- Simulation only; not validated on real fleets.
- Faults are injected, so ground truth is known; real incidents are messier.
- Detection thresholds are fixed.
- Mild faults (slowed station, partly blocked door, slow robot) fall below the detector's threshold and are not detected.
- Replay diagnosis underperforms on decoy cases.
- Classical search and simulation; no trained model.
