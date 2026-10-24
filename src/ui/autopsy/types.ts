// Autopsy data as shown by the UI: the precomputed JSON shape (buildAutopsy) or
// the same fields built live from a worker diagnosis and verifyFix.
import type { Diagnosis, FixResult } from '../../diagnosis/types';
import type { Jam } from '../../sim/jam';
import type { SimConfig } from '../../sim/types';

export interface AutopsyData {
  scenarioId: string | null;
  layoutId: string;
  seed: number;
  robots: number;
  ticks: number;
  jam: Jam;
  diagnosis: Omit<Diagnosis, 'elapsedMs'> & { elapsedMs?: number };
  fix: FixResult;
}

/** An autopsy bound to the run it was made for. */
export interface AutopsyRun {
  /** Run key (layout, robots, seed, scenario) the autopsy belongs to. */
  key: string;
  data: AutopsyData;
  /** The world the observed run used (for replays and the fix run). */
  world: SimConfig;
}

/** Scenarios with a precomputed file in public/autopsies/. */
export const CURATED_AUTOPSIES: readonly string[] = [
  'fb-aisle-freeze',
  'fb-station-slow',
  'cp-door-freeze',
  'cp-lower-door-freeze',
  'pd-holder-freeze',
  'pd-decoy-first',
];

export const DECOY_SCENARIO = 'pd-decoy-first';
