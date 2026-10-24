// Counterfactual scoring (Spec 3, Requirement 3): replay the deterministic sim from
// tick 0 with the Observed_Config plus base faults plus one hypothesis, and compare
// the replay to the observed Recording on observables only (positions, throughput,
// station queue lengths). Never reads the fault list of `config`.
// Formula and weights: design.md "Scoring (task 4)".

import type { Jam } from '../sim/jam';
import type { Layout } from '../sim/layout';
import { throughputSeries } from '../sim/metrics';
import type { Recording } from '../sim/recorder';
import { runHeadless } from '../sim/sim';
import type { FaultEvent, SimConfig } from '../sim/types';
import type { ObservedConfig, Window } from './types';

/** Frames after detectedTick that the Observation_Window extends to. */
export const WINDOW_AFTER = 200;
/** Weight of the position match term. */
export const W_POS = 0.3;
/** Weight of the throughput term. */
export const W_TP = 0.5;
/** Weight of the queue-length term. */
export const W_QUEUE = 0.2;
/** Per-frame weight of position matches at or after `fromTick` (frames before weigh 1). */
export const POST_WEIGHT = 1;

/** Observation_Window: frames 0..min(detectedTick + 200, last recorded frame). */
export function observationWindow(rec: Recording, jam: Jam): Window {
  if (rec.frames < 1) throw new RangeError('recording has no frames');
  return { endTick: Math.min(jam.detectedTick + WINDOW_AFTER, rec.frames - 1) };
}

/** True when both recordings agree on positions and queue lengths in frames 0..end. */
function framesEqual(a: Recording, b: Recording, end: number): boolean {
  const np = (end + 1) * a.robots;
  for (let i = 0; i < np; i++) if (a.positions[i] !== b.positions[i]) return false;
  const nq = (end + 1) * a.stations;
  for (let i = 0; i < nq; i++) if (a.queueLen[i] !== b.queueLen[i]) return false;
  return true;
}

/** Sum |x - y| / sum max(x, y) over two equal-length series; 0 when both are all zero. */
function relError(x: ArrayLike<number>, y: ArrayLike<number>, from: number, to: number): number {
  let diff = 0;
  let total = 0;
  for (let i = from; i < to; i++) {
    const a = x[i];
    const b = y[i];
    diff += a > b ? a - b : b - a;
    total += a > b ? a : b;
  }
  return total === 0 ? 0 : diff / total;
}

/**
 * Similarity in [0, 1] of `replay` to `observed` on frames 0..window.endTick:
 *   W_POS * P + W_TP * (1 - E_tp) + W_QUEUE * (1 - E_q)
 * P: per-robot position match rate over frames 1..endTick, frames >= fromTick weigh POST_WEIGHT.
 * E_tp: relative L1 error of the throughput curves (frames 0..endTick).
 * E_q: relative L1 error of the per-station queue lengths (frames 0..endTick).
 * Exactly 1 when positions, queue lengths, and therefore throughput match on every
 * frame of the window. Throws RangeError when a recording is too short or the
 * robot or station counts differ.
 */
export function similarity(replay: Recording, observed: Recording, window: Window, fromTick: number): number {
  const end = window.endTick;
  if (!Number.isInteger(end) || end < 0 || end >= replay.frames || end >= observed.frames) {
    throw new RangeError(`window end ${end} is outside both recordings (${replay.frames}, ${observed.frames} frames)`);
  }
  if (replay.robots !== observed.robots || replay.stations !== observed.stations) {
    throw new RangeError('recordings differ in robot or station count');
  }
  const n = observed.robots;

  // Throughput is derived from Deliver events; compare it even when frames agree.
  const tpR = throughputSeries(replay, end);
  const tpO = throughputSeries(observed, end);
  const eTp = relError(tpR, tpO, 0, end + 1);
  if (eTp === 0 && framesEqual(replay, observed, end)) return 1;

  // Position match rate, weighted toward frames at or after fromTick.
  let matched = 0;
  let weight = 0;
  for (let t = 1; t <= end; t++) {
    const w = t >= fromTick ? POST_WEIGHT : 1;
    const o = t * n;
    let m = 0;
    for (let r = 0; r < n; r++) if (replay.positions[o + r] === observed.positions[o + r]) m++;
    matched += w * m;
    weight += w * n;
  }
  const p = weight === 0 ? 1 : matched / weight;

  const nq = (end + 1) * observed.stations;
  const eQ = relError(replay.queueLen, observed.queueLen, 0, nq);

  const s = W_POS * p + W_TP * (1 - eTp) + W_QUEUE * (1 - eQ);
  // Not an exact replay: keep the score strictly below the exact-match value.
  return s < 0 ? 0 : s >= 1 ? 1 - Number.EPSILON : s;
}

/**
 * Replays the Observed_Config with faults [...base, h] (h omitted when null) for
 * window.endTick ticks and scores it against `observed`. Only seed, robots, and
 * queueCap are read from `config`. Positions are weighted from h.tick, or from the
 * earliest base fault when h is null (0 without faults).
 * Throws when the combined faults fail validateFaults (blocked-cell unions).
 */
export function scoreHypothesis(
  layout: Layout,
  config: ObservedConfig | SimConfig,
  h: FaultEvent | null,
  observed: Recording,
  window: Window,
  base: readonly FaultEvent[],
): { score: number; replay: Recording } {
  const list: FaultEvent[] = h === null ? [...base] : [...base, h];
  const replay = runHeadless(
    layout,
    { seed: config.seed, robots: config.robots, queueCap: config.queueCap, faults: list },
    window.endTick,
  );
  let fromTick = 0;
  if (h !== null) fromTick = h.tick;
  else if (base.length > 0) fromTick = Math.min(...base.map((f) => f.tick));
  return { score: similarity(replay, observed, window, fromTick), replay };
}
