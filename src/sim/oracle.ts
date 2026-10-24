// Fault oracle (design.md D14): scores each fault of a config by re-running
// headless without it and measuring how much of the lost throughput returns.

import { blockableCells, validateFaults } from './faults';
import type { Layout } from './layout';
import type { Recording } from './recorder';
import { mulberry32, randInt } from './rng';
import { runHeadless } from './sim';
import { EKind } from './types';
import type { FaultEvent, FaultKind, GroundTruth, Scenario, SimConfig } from './types';

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

// ---- scenario generator (design.md D12, D13) ----

/** Ground truth of every generated scenario: decoy at index 0, primary at index 1. */
const GEN_TRUTH: GroundTruth = { primaryFaultIndex: 1, decoyIndices: [0] };

/** One fault of a uniformly drawn kind; `duration` null makes it permanent. */
function sampleFault(
  rng: () => number,
  layout: Layout,
  robots: number,
  cells: Int16Array,
  tick: number,
  duration: number | null,
): FaultEvent {
  const kinds: FaultKind[] = ['robot-freeze', 'station-slowdown', 'slow-robot'];
  if (cells.length > 0) kinds.push('blocked-cell');
  const kind = kinds[randInt(rng, 0, kinds.length - 1)];
  switch (kind) {
    case 'robot-freeze':
      return { kind, tick, robot: randInt(rng, 0, robots - 1), duration };
    case 'station-slowdown':
      return { kind, tick, station: randInt(rng, 0, layout.stations.length - 1), factor: randInt(rng, 2, 4), duration };
    case 'slow-robot':
      return { kind, tick, robot: randInt(rng, 0, robots - 1), period: randInt(rng, 2, 4), duration };
    case 'blocked-cell':
      return { kind, tick, cell: cells[randInt(rng, 0, cells.length - 1)], duration };
  }
}

/**
 * Seeded rejection sampling of `count` decoy-first scenarios (D13): robots =
 * recommended, sim seed = `seed`, one fault-free baseline per call. A candidate
 * is a short decoy (duration 20 to 40, tick in [300, primary tick − 50]) and a
 * permanent primary (tick in [350, 700]). It is kept when the primary alone
 * loses at least MIN_LOSS and the oracle confirms the ground truth. Throws
 * after `maxAttempts` (default 30 × count) candidates.
 */
export function generateScenarios(
  layout: Layout,
  seed: number,
  count: number,
  opts: { maxAttempts?: number } = {},
): Scenario[] {
  const maxAttempts = opts.maxAttempts ?? 30 * count;
  const robots = layout.recommendedRobots;
  const config: SimConfig = { seed, robots, queueCap: layout.queueCap, faults: [] };
  const run = (faults: FaultEvent[]) => deliveries(runHeadless(layout, { ...config, faults }, ORACLE_TICKS));
  const rng = mulberry32(seed);
  const cells = blockableCells(layout);
  const out: Scenario[] = [];
  let baseline = -1;
  let attempts = 0;
  while (out.length < count && attempts < maxAttempts) {
    attempts++;
    const primaryTick = randInt(rng, 350, 700);
    const decoyTick = randInt(rng, 300, primaryTick - 50);
    const decoy = sampleFault(rng, layout, robots, cells, decoyTick, randInt(rng, 20, 40));
    const primary = sampleFault(rng, layout, robots, cells, primaryTick, null);
    const faults = [decoy, primary];
    try {
      validateFaults(layout, robots, faults);
    } catch {
      continue; // blocked cells together disconnect the floor
    }
    if (baseline < 0) baseline = run([]);
    const primaryOnly = run([primary]);
    if (baseline <= 0 || (baseline - primaryOnly) / baseline < MIN_LOSS) continue;
    const withAll = run(faults);
    const decoyOnly = run([decoy]);
    const without = [primaryOnly, decoyOnly];
    const r: OracleResult = { baseline, withAll, without, recovered: computeRecovered(baseline, withAll, without) };
    if (!isValid(r, GEN_TRUTH)) continue;
    out.push({
      id: `${layout.id}-gen-${seed}-${out.length}`,
      name: `generated ${primary.kind.replace('-', ' ')} + decoy`,
      layoutId: layout.id,
      seed,
      robots,
      faults,
      groundTruth: { primaryFaultIndex: GEN_TRUTH.primaryFaultIndex, decoyIndices: [...GEN_TRUTH.decoyIndices] },
    });
  }
  if (out.length < count) {
    throw new Error(
      `generateScenarios: ${layout.id} seed ${seed}: found ${out.length} of ${count} valid scenarios in ${attempts} attempts`,
    );
  }
  return out;
}
