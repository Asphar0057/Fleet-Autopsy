// Curated failure scenarios (Spec 2, Requirement 5, design.md D23, D24).
// Placements are literal constants picked from fault-free runs and checked by
// tests/scenarios.test.ts (placement predicates, oracle, verifier) and
// tests/jam.test.ts (detection within 200 ticks of the primary fault).

import type { Layout } from './layout';
import type { Scenario, SimConfig } from './types';

export type { GroundTruth, Scenario } from './types';

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'fb-aisle-freeze',
    name: 'frozen robot in aisle',
    layoutId: 'fulfillment-block',
    seed: 1,
    robots: 36,
    // R14 at (19, 12), a one-cell aisle between pod blocks, at frame 599.
    faults: [{ kind: 'robot-freeze', tick: 600, robot: 14, duration: null }],
    groundTruth: { primaryFaultIndex: 0, decoyIndices: [] },
  },
  {
    id: 'fb-station-slow',
    name: 'slow station',
    layoutId: 'fulfillment-block',
    seed: 1,
    robots: 45,
    // Station index 1 at (37, 5): most service starts in ticks 1 to 399.
    faults: [{ kind: 'station-slowdown', tick: 400, station: 1, factor: 4, duration: null }],
    groundTruth: { primaryFaultIndex: 0, decoyIndices: [] },
  },
  {
    id: 'cp-door-freeze',
    name: 'frozen robot in upper door',
    layoutId: 'chokepoint',
    seed: 1,
    robots: 22,
    // R7 on door cell 192 (17, 5) at frame 349.
    faults: [{ kind: 'robot-freeze', tick: 350, robot: 7, duration: null }],
    groundTruth: { primaryFaultIndex: 0, decoyIndices: [] },
  },
  {
    id: 'cp-lower-door-freeze',
    name: 'frozen robot in lower door',
    layoutId: 'chokepoint',
    seed: 1,
    robots: 22,
    // R9 on door cell 542 (17, 15) at frame 499.
    faults: [{ kind: 'robot-freeze', tick: 500, robot: 9, duration: null }],
    groundTruth: { primaryFaultIndex: 0, decoyIndices: [] },
  },
  {
    id: 'pd-holder-freeze',
    name: 'frozen station holder',
    layoutId: 'pocket-dc',
    seed: 1,
    robots: 9,
    // R4 serving on station 0 (1, 5) at frame 399.
    faults: [{ kind: 'robot-freeze', tick: 400, robot: 4, duration: null }],
    groundTruth: { primaryFaultIndex: 0, decoyIndices: [] },
  },
  {
    id: 'pd-decoy-first',
    name: 'decoy, then frozen holder',
    layoutId: 'pocket-dc',
    seed: 3,
    robots: 9,
    // Decoy: R6 on open floor (16, 2) at frame 349. Primary: R3 serving on station 1 (22, 5) at frame 549.
    faults: [
      { kind: 'robot-freeze', tick: 350, robot: 6, duration: 30 },
      { kind: 'robot-freeze', tick: 550, robot: 3, duration: null },
    ],
    groundTruth: { primaryFaultIndex: 1, decoyIndices: [0] },
  },
];

/** SimConfig for a scenario, with the queue cap from its layout and a copy of its faults. */
export function scenarioConfig(s: Scenario, layout: Layout): SimConfig {
  if (layout.id !== s.layoutId) {
    throw new Error(`scenario ${s.id} is for layout ${s.layoutId}, got ${layout.id}`);
  }
  return { seed: s.seed, robots: s.robots, queueCap: layout.queueCap, faults: s.faults.map((f) => ({ ...f })) };
}
