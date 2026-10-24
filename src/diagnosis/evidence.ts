// Evidence extraction (Spec 3, Requirement 1): observables an operator could see,
// read from a Recording up to jam.detectedTick only. Never reads faults.
// Every output is plain JSON-safe data (numbers, arrays, plain objects).

import { validateFaults } from '../sim/faults';
import type { Jam } from '../sim/jam';
import type { Layout } from '../sim/layout';
import { createWaitCounter, throughputSeries } from '../sim/metrics';
import type { Recording } from '../sim/recorder';
import { EKind, RState } from '../sim/types';
import type { Evidence, Service, Standstill } from './types';

/** Standstill frames that make a non-serving robot stalled. */
export const STALL_MIN = 20;
/** Standstill frames that make a serving robot stalled (above 14 x 4, the slowest legal service). */
export const SERVE_STALL = 60;
/** Hot-spot cells kept, by waits. */
export const HOTSPOTS = 16;
/** Move window: frames in (onsetTick - MOVE_WINDOW, detectedTick]. */
export const MOVE_WINDOW = 200;
/** A busy cell went empty when unoccupied for at least this many frames before detectedTick. */
export const BLOCK_GAP = 60;
/** Entries into a cell in [L - BLOCK_LOOKBACK, L] needed for it to count as busy. */
export const BLOCK_ENTRIES = 5;
export const BLOCK_LOOKBACK = 200;

/** Threshold for a standstill run whose last frame has state `st`. */
export function stallThreshold(serving: boolean): number {
  return serving ? SERVE_STALL : STALL_MIN;
}

/** True when the cell passes validateFaults as a lone blocked-cell fault (same rule as blockableCells). */
function isBlockable(layout: Layout, robots: number, cell: number): boolean {
  try {
    validateFaults(layout, robots, [{ kind: 'blocked-cell', tick: 1, cell, duration: null }]);
    return true;
  } catch {
    return false;
  }
}

/** First event index with evTick > tick. Events are appended in tick order. */
function eventEnd(rec: Recording, tick: number): number {
  let lo = 0;
  let hi = rec.events;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rec.evTick[mid] <= tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Evidence from frames 0..jam.detectedTick and events with evTick <= detectedTick.
 *
 * Standstill (Diagnoser rule, design D6): frame t >= 1 counts when the robot's cell
 * equals its cell at t - 1 and its state at t is not Idle. Serving counts. A run's
 * `start` is its first counted frame; `serving` is the state at its last frame.
 * Throws RangeError when detectedTick is outside [0, rec.frames).
 */
export function extractEvidence(rec: Recording, layout: Layout, jam: Jam): Evidence {
  const d = jam.detectedTick;
  if (!Number.isInteger(d) || d < 0 || d >= rec.frames) {
    throw new RangeError(`tick ${d} is outside [0, ${rec.frames})`);
  }
  const n = rec.robots;
  const S = rec.stations;
  const cells = layout.width * layout.height;
  const pos = rec.positions;
  const states = rec.states;
  const moveFrom = jam.onsetTick - MOVE_WINDOW; // exclusive

  // ---- one pass over frames: standstill runs, moves, last occupancy ----
  const runStart = new Int32Array(n).fill(-1); // first counted frame of the open run, -1 if none
  const episodes: Standstill[] = [];
  const moves: number[][] = [];
  for (let r = 0; r < n; r++) moves.push([]);
  const lastOcc = new Int32Array(cells).fill(-1);

  for (let r = 0; r < n; r++) lastOcc[pos[r]] = 0;
  for (let t = 1; t <= d; t++) {
    const cur = t * n;
    const prev = cur - n;
    for (let r = 0; r < n; r++) {
      const c = pos[cur + r];
      lastOcc[c] = t;
      const still = c === pos[prev + r] && states[cur + r] !== RState.Idle;
      if (still) {
        if (runStart[r] < 0) runStart[r] = t;
        continue;
      }
      if (c !== pos[prev + r] && t > moveFrom) moves[r].push(t);
      if (runStart[r] >= 0) {
        // Run closed at frame t - 1.
        const serving = states[prev + r] === RState.Serving;
        const len = t - runStart[r];
        if (len >= stallThreshold(serving)) {
          episodes.push({ robot: r, start: runStart[r], end: t - 1, cell: pos[prev + r], serving });
        }
        runStart[r] = -1;
      }
    }
  }

  // ---- open runs at d ----
  const standstillStart: number[] = [];
  const standstillCell: number[] = [];
  const stalled: number[] = [];
  const dOff = d * n;
  for (let r = 0; r < n; r++) {
    const s = runStart[r];
    standstillStart.push(s);
    standstillCell.push(s >= 0 ? pos[dOff + r] : -1);
    if (s < 0) continue;
    const serving = states[dOff + r] === RState.Serving;
    if (d - s + 1 >= stallThreshold(serving)) {
      stalled.push(r);
      episodes.push({ robot: r, start: s, end: d, cell: pos[dOff + r], serving });
    }
  }
  stalled.sort((a, b) => standstillStart[a] - standstillStart[b] || a - b);
  episodes.sort((a, b) => a.start - b.start || a.robot - b.robot);

  // ---- hot-spots ----
  const waits = createWaitCounter(layout).at(rec, d);
  const hot: { cell: number; waits: number }[] = [];
  for (let c = 0; c < cells; c++) if (waits[c] > 0) hot.push({ cell: c, waits: waits[c] });
  hot.sort((a, b) => b.waits - a.waits || a.cell - b.cell);
  const hotspots = hot.slice(0, HOTSPOTS);

  // ---- services and completions ----
  const services: Service[][] = [];
  for (let s = 0; s < S; s++) services.push([]);
  const completions: number[] = new Array<number>(S).fill(0);
  const open: (Service | null)[] = new Array<Service | null>(n).fill(null);
  const openStn = new Int32Array(n).fill(-1);
  const evEnd = eventEnd(rec, d);
  for (let e = 0; e < evEnd; e++) {
    const k = rec.evKind[e];
    const r = rec.evRobot[e];
    if (r < 0 || r >= n) continue;
    if (k === EKind.ServiceStart) {
      const s = rec.evArg[e];
      if (s < 0 || s >= S) continue;
      const svc: Service = { robot: r, start: rec.evTick[e], end: -1 };
      services[s].push(svc);
      open[r] = svc;
      openStn[r] = s;
    } else if (k === EKind.ServiceEnd) {
      const svc = open[r];
      if (svc === null) continue;
      svc.end = rec.evTick[e];
      completions[openStn[r]]++;
      open[r] = null;
      openStn[r] = -1;
    }
  }
  for (const list of services) list.sort((a, b) => a.start - b.start || a.robot - b.robot);

  // ---- throughput ----
  const throughput = Array.from(throughputSeries(rec, d));

  // ---- busy cells that went empty ----
  // Candidates: last occupied L with d - L >= BLOCK_GAP. Count entries in [L - 200, L].
  const entries = new Int32Array(cells);
  let anyCandidate = false;
  for (let c = 0; c < cells; c++) {
    if (lastOcc[c] >= 0 && d - lastOcc[c] >= BLOCK_GAP) anyCandidate = true;
  }
  if (anyCandidate) {
    for (let t = 1; t <= d; t++) {
      const cur = t * n;
      const prev = cur - n;
      for (let r = 0; r < n; r++) {
        const c = pos[cur + r];
        if (c === pos[prev + r]) continue;
        const L = lastOcc[c];
        if (d - L >= BLOCK_GAP && t >= L - BLOCK_LOOKBACK && t <= L) entries[c]++;
      }
    }
  }
  const lastOccupied: { cell: number; tick: number; entries: number }[] = [];
  for (let c = 0; c < cells; c++) {
    if (entries[c] < BLOCK_ENTRIES) continue;
    if (!isBlockable(layout, n, c)) continue;
    lastOccupied.push({ cell: c, tick: lastOcc[c], entries: entries[c] });
  }
  lastOccupied.sort((a, b) => b.entries - a.entries || a.cell - b.cell);

  return {
    detectedTick: d,
    onsetTick: jam.onsetTick,
    standstillStart,
    standstillCell,
    stalled,
    episodes,
    hotspots,
    services,
    completions,
    throughput,
    moves,
    lastOccupied,
  };
}
