// Metrics: pure functions over a Recording (Requirement 7).
// Events are appended in tick order, so window queries binary-search evTick.
// Event ticks are frame indices (the frame the event's tick produces).

import type { Layout } from './layout';
import type { Recording } from './recorder';
import { EKind, RState } from './types';

/** Throughput window length in ticks (Requirement 7.1). */
export const THROUGHPUT_WINDOW = 100;

const MAX_WAIT = 65535;

/** First event index e with evTick[e] > tick (upper bound). */
function upperBound(rec: Recording, tick: number): number {
  let lo = 0;
  let hi = rec.events;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rec.evTick[mid] <= tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Number of deliver events with tick in (tick - 100, tick]. */
export function throughputAt(rec: Recording, tick: number): number {
  const end = upperBound(rec, tick);
  const start = upperBound(rec, tick - THROUGHPUT_WINDOW);
  let count = 0;
  for (let e = start; e < end; e++) if (rec.evKind[e] === EKind.Deliver) count++;
  return count;
}

/**
 * throughputAt(rec, t) for every t in 0..upTo, as a new Int16Array of length upTo + 1.
 * One sliding-window pass over the events: O(upTo + events).
 */
export function throughputSeries(rec: Recording, upTo: number): Int16Array {
  const out = new Int16Array(Math.max(0, upTo + 1));
  let head = 0; // first event with evTick > t
  let tail = 0; // first event with evTick > t - window
  let count = 0;
  for (let t = 0; t <= upTo; t++) {
    while (head < rec.events && rec.evTick[head] <= t) {
      if (rec.evKind[head] === EKind.Deliver) count++;
      head++;
    }
    while (tail < head && rec.evTick[tail] <= t - THROUGHPUT_WINDOW) {
      if (rec.evKind[tail] === EKind.Deliver) count--;
      tail++;
    }
    out[t] = count;
  }
  return out;
}

/** Mean of (service-end tick - task-start tick) over service-end events up to `tick`; NaN if none (D6). */
export function meanCycleTime(rec: Recording, tick: number): number {
  const end = upperBound(rec, tick);
  let sum = 0;
  let count = 0;
  for (let e = 0; e < end; e++) {
    if (rec.evKind[e] === EKind.ServiceEnd) {
      sum += rec.evTick[e] - rec.evArg[e];
      count++;
    }
  }
  return count === 0 ? NaN : sum / count;
}

/** Queued robots per station at `tick` (D7), as a view into the recording (no copy). */
export function queueLengths(rec: Recording, tick: number): Uint8Array {
  if (!Number.isInteger(tick) || tick < 0 || tick >= rec.frames) {
    throw new RangeError(`tick ${tick} is outside [0, ${rec.frames})`);
  }
  return rec.queueLen.subarray(tick * rec.stations, (tick + 1) * rec.stations);
}

export interface WaitCounter {
  /**
   * Per-cell wait counts up to `tick` (D11): the number of (robot, t) with 1 <= t <= tick
   * where the robot's cell at frame t equals its cell at frame t - 1 and its state at
   * frame t is neither serving nor idle. Saturates at 65535.
   * The returned array is owned and reused by the counter; it changes on the next call.
   */
  at(rec: Recording, tick: number): Uint16Array;
}

/**
 * Wait counter with an incremental cache: a later tick on the same recording extends
 * from the last tick; an earlier tick (or a different recording) recounts from 0.
 */
export function createWaitCounter(layout: Layout): WaitCounter {
  const counts = new Uint16Array(layout.width * layout.height);
  let lastRec: Recording | null = null;
  let lastTick = 0; // counts cover frames 1..lastTick

  function addFrame(rec: Recording, t: number): void {
    const n = rec.robots;
    const cur = t * n;
    const prev = cur - n;
    for (let i = 0; i < n; i++) {
      const c = rec.positions[cur + i];
      if (c !== rec.positions[prev + i]) continue;
      const st = rec.states[cur + i];
      if (st === RState.Serving || st === RState.Idle) continue;
      if (counts[c] < MAX_WAIT) counts[c]++;
    }
  }

  return {
    at(rec, tick) {
      if (!Number.isInteger(tick) || tick < 0 || tick >= rec.frames) {
        throw new RangeError(`tick ${tick} is outside [0, ${rec.frames})`);
      }
      if (rec !== lastRec || tick < lastTick) {
        counts.fill(0);
        lastRec = rec;
        lastTick = 0;
      }
      for (let t = lastTick + 1; t <= tick; t++) addFrame(rec, t);
      lastTick = tick;
      return counts;
    },
  };
}

/**
 * Marks in `out[r]` (1 = stalled, 0 = not) every robot that is stalled at `tick`:
 * it has a stall event at or before `tick` and has not moved since that event,
 * i.e. its cell is the same in every frame from the event's tick through `tick`.
 * `out` must have length >= rec.robots. Throws RangeError outside [0, frames).
 */
export function stalledAt(rec: Recording, tick: number, out: Uint8Array): void {
  if (!Number.isInteger(tick) || tick < 0 || tick >= rec.frames) {
    throw new RangeError(`tick ${tick} is outside [0, ${rec.frames})`);
  }
  const n = rec.robots;
  out.fill(0, 0, n);
  // First frame of each robot's current standstill (cells equal from there through `tick`).
  const since = new Int32Array(n);
  let earliest = tick;
  for (let r = 0; r < n; r++) {
    const c = rec.positions[tick * n + r];
    let t = tick;
    while (t > 0 && rec.positions[(t - 1) * n + r] === c) t--;
    since[r] = t;
    if (t < earliest) earliest = t;
  }
  // Stall events inside a robot's standstill window, scanned backward from `tick`.
  for (let e = upperBound(rec, tick) - 1; e >= 0 && rec.evTick[e] >= earliest; e--) {
    if (rec.evKind[e] !== EKind.Stall) continue;
    const r = rec.evRobot[e];
    if (r >= 0 && r < n && rec.evTick[e] >= since[r]) out[r] = 1;
  }
}
