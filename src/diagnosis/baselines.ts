// Naive baselines and ground-truth matching (Spec 3, Requirement 5).
// Pure functions of Evidence and fault values; never reads a fault list.
// Rules: design.md "Baselines (task 6)".

import type { Layout } from '../sim/layout';
import type { FaultEvent } from '../sim/types';
import type { Target } from './types';

/**
 * True exactly when `t` names the same kind and target as `truth`; for
 * blocked-cell, the cell may also be 4-adjacent (layout.neighbors, E W S N).
 * Never matches null.
 */
export function matchesGroundTruth(t: Target | null, truth: FaultEvent, layout: Layout): boolean {
  if (t === null || t.kind !== truth.kind) return false;
  switch (truth.kind) {
    case 'robot-freeze':
    case 'slow-robot':
      return t.robot === truth.robot;
    case 'station-slowdown':
      return t.station === truth.station;
    case 'blocked-cell': {
      if (t.cell === undefined) return false;
      if (t.cell === truth.cell) return true;
      for (let k = 0; k < 4; k++) {
        const n = layout.neighbors[truth.cell * 4 + k];
        if (n >= 0 && n === t.cell) return true;
      }
      return false;
    }
  }
}

/** The Target of a fault: its kind plus only its robot, station, or cell. */
export function targetOf(f: FaultEvent): Target {
  switch (f.kind) {
    case 'robot-freeze':
    case 'slow-robot':
      return { kind: f.kind, robot: f.robot };
    case 'station-slowdown':
      return { kind: f.kind, station: f.station };
    case 'blocked-cell':
      return { kind: f.kind, cell: f.cell };
  }
}
