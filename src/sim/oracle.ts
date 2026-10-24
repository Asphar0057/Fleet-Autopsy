// Fault oracle (design.md D14): scores each fault of a config by re-running
// headless without it and measuring how much of the lost throughput returns.

import type { Layout } from './layout';
import type { Recording } from './recorder';
import { runHeadless } from './sim';
import { EKind } from './types';
import type { GroundTruth, SimConfig } from './types';

export const ORACLE_TICKS = 2000;
export const MIN_LOSS = 0.1;
export const PRIMARY_MIN = 0.7;
export const DECOY_MAX = 0.1;

export interface OracleResult {
  /** Fault-free deliveries. */
  baseline: number;
  /** Deliveries with all faults. */
  withAll: number;
  /** Deliveries with fault k removed, per fault. */
  without: number[];
  /** Recovered_Fraction per fault. */
  recovered: number[];
}

/** Number of Deliver events in the recording (ticks 0 to frames - 1). */
export function deliveries(rec: Recording): number {
  let n = 0;
  for (let e = 0; e < rec.events; e++) {
    if (rec.evKind[e] === EKind.Deliver && rec.evTick[e] < rec.frames) n++;
  }
  return n;
}

/**
 * Recovered_Fraction per fault: (without[k] - withAll) / (baseline - withAll).
 * When the gap is not positive, every fraction is 0 (D14).
 */
export function computeRecovered(baseline: number, withAll: number, without: readonly number[]): number[] {
  const gap = baseline - withAll;
  if (gap <= 0) return without.map(() => 0);
  return without.map((w) => (w - withAll) / gap);
}

/**
 * Runs fault-free, with all faults, and once per fault with that fault removed,
 * each for `ticks` ticks via runHeadless, and returns the Recovered_Fractions.
 */
export function scoreFaults(layout: Layout, config: SimConfig, ticks: number = ORACLE_TICKS): OracleResult {
  const run = (faults: SimConfig['faults']) => deliveries(runHeadless(layout, { ...config, faults }, ticks));
  const baseline = run([]);
  const withAll = run(config.faults);
  const without = config.faults.map((_, k) => run(config.faults.filter((_f, i) => i !== k)));
  return { baseline, withAll, without, recovered: computeRecovered(baseline, withAll, without) };
}

/**
 * Valid when all faults cost at least MIN_LOSS of fault-free deliveries (and the
 * gap is positive), the primary recovers at least PRIMARY_MIN, and every decoy
 * recovers less than DECOY_MAX. Ratios are compared by division so exact
 * integer ratios such as 3/30 match the thresholds exactly.
 */
export function isValid(r: OracleResult, gt: GroundTruth): boolean {
  const gap = r.baseline - r.withAll;
  if (gap <= 0 || gap / r.baseline < MIN_LOSS) return false;
  if (!(r.recovered[gt.primaryFaultIndex] >= PRIMARY_MIN)) return false;
  return gt.decoyIndices.every((d) => r.recovered[d] < DECOY_MAX);
}
