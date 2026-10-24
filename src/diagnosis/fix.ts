// Verified fix (Spec 3, Requirement 6): propose a fix for the diagnosed root cause
// and check it in simulation against the true world. This module reads the
// World_Config fault list (design D10), so it sits outside the Diagnoser lint block.
// Rules: design.md "Fix (task 7)".

import type { Layout } from '../sim/layout';
import { deliveries } from '../sim/oracle';
import { runHeadless } from '../sim/sim';
import type { FaultEvent, SimConfig } from '../sim/types';
import { matchesGroundTruth, targetOf } from './baselines';
import type { Diagnosis, FixResult } from './types';

/** Recovered fraction needed to pass (Requirement 6.2, not tunable). */
export const FIX_PASS = 0.7;
/** Ticks of each verification run (design D10, same as ORACLE_TICKS). */
export const FIX_TICKS = 2000;

/**
 * Recovered fraction of the lost deliveries and the pass decision. A non-positive
 * gap gives 0 (nothing lost, nothing shown recovered); otherwise the fraction is
 * clamped to [0, 1].
 */
export function fixOutcome(
  baseline: number,
  before: number,
  after: number,
): { recoveredFraction: number; passed: boolean } {
  const gap = baseline - before;
  const recoveredFraction = gap <= 0 ? 0 : Math.min(1, Math.max(0, (after - before) / gap));
  return { recoveredFraction, passed: recoveredFraction >= FIX_PASS };
}

/** One fixed sentence per fault kind, naming its robot, station, or cell. */
export function proposeFix(f: FaultEvent, layout: Layout): string {
  switch (f.kind) {
    case 'robot-freeze':
      return `take R${f.robot} out of service and clear it from the floor`;
    case 'station-slowdown':
      return `restore station S${String(f.station + 1).padStart(2, '0')} to its normal service time`;
    case 'blocked-cell':
      return `clear the obstruction at cell ${f.cell} (${f.cell % layout.width}, ${Math.floor(f.cell / layout.width)})`;
    case 'slow-robot':
      return `take R${f.robot} out of service for a drive check`;
  }
}

/**
 * Removes every world fault matching the diagnosed root cause, replays from
 * tick 0 for `ticks` ticks, and compares deliveries with the no-fault baseline
 * and the faulted run. Throughputs are deliveries per 100 ticks.
 */
export function verifyFix(layout: Layout, world: SimConfig, d: Diagnosis, ticks: number = FIX_TICKS): FixResult {
  const base = { seed: world.seed, robots: world.robots, queueCap: world.queueCap };
  const count = (faults: FaultEvent[]): number => deliveries(runHeadless(layout, { ...base, faults }, ticks));
  const per100 = (n: number): number => (ticks > 0 ? (n * 100) / ticks : 0);

  const baseline = count([]);
  const before = count(world.faults);

  let fix: string | null = null;
  let removed: FaultEvent[] = [];
  let after = before;
  if (d.rootCause !== null) {
    const target = targetOf(d.rootCause.fault);
    removed = world.faults.filter((f) => matchesGroundTruth(target, f, layout));
    if (removed.length > 0) after = count(world.faults.filter((f) => !removed.includes(f)));
    fix = proposeFix(d.rootCause.fault, layout);
  }

  // With no root cause or nothing removed, after = before, so the fraction is 0 and the fix fails.
  const { recoveredFraction, passed } = fixOutcome(baseline, before, after);

  return {
    fix,
    removed,
    throughputBaseline: per100(baseline),
    throughputBefore: per100(before),
    throughputAfter: per100(after),
    recoveredFraction,
    passed,
    verifiedBy: 'simulation',
  };
}
