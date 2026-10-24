// Telemetry (Spec 2, Requirement 3): signals a real fleet could report, derived
// from a Recording and Layout only. This module never reads faults or Sim
// internals; a lint rule forbids importing faults, sim, oracle, or scenarios.
//
// Live recordings: the Recorder reallocates its typed arrays when it grows, so
// every advance() reads rec fields fresh and never caches buffer references.

import type { Layout } from './layout';
import { createWaitCounter } from './metrics';
import type { Recording } from './recorder';
import { EKind, RState } from './types';

/** Standstill thresholds for the stalled20 / stalled100 series. */
export const STANDSTILL_SHORT = 20;
export const STANDSTILL_LONG = 100;
/** Completed services averaged per station. */
export const SERVICE_SAMPLES = 5;
/** Trailing window for per-station completions. */
export const COMPLETIONS_WINDOW = 100;

/** Throughput window for telemetry and detection (D18): 100 for every preset. */
export function jamWindow(layout: Layout): number {
  void layout;
  return 100;
}

export interface Telemetry {
  upTo: number;
  window: number;
  /** [0..upTo], deliveries in (t - window, t]. */
  throughput: Int16Array;
  /** [0..upTo], robots with standstill >= 20. */
  stalled20: Int16Array;
  /** [0..upTo], robots with standstill >= 100. */
  stalled100: Int16Array;
  /** View of rec.queueLen, (upTo + 1) x stations. */
  queueLen: Uint8Array;
  /** Per robot at upTo (D15). */
  standstill: Int32Array;
  /** Per station at upTo: mean of the last 5 service durations, NaN if none. */
  serviceMean: Float64Array;
  /** Per station: service-end events in (upTo - 100, upTo]. */
  completions: Int16Array;
  /** Per cell at upTo (createWaitCounter, Spec 1 D11). */
  waits: Uint16Array;
}

export interface TelemetryTracker {
  /**
   * Telemetry up to frame `upTo`. A later tick extends from the last one; an
   * earlier tick recounts from 0. The returned object and all its arrays are
   * owned by the tracker and overwritten by the next advance(); copy to keep.
   * Throws RangeError for a tick outside [0, rec.frames).
   */
  advance(upTo: number): Telemetry;
}

function growI16(a: Int16Array, min: number): Int16Array {
  let cap = Math.max(1, a.length);
  while (cap < min) cap *= 2;
  if (cap === a.length) return a;
  const b = new Int16Array(cap);
  b.set(a);
  return b;
}

export function createTelemetryTracker(rec: Recording, layout: Layout): TelemetryTracker {
  const n = rec.robots;
  const S = rec.stations;
  const window = jamWindow(layout);
  const waitCounter = createWaitCounter(layout);

  // Series buffers, grown by doubling.
  let tp: Int16Array = new Int16Array(256);
  let s20: Int16Array = new Int16Array(256);
  let s100: Int16Array = new Int16Array(256);
  // Per robot.
  const standstill = new Int32Array(n);
  const startTick = new Int32Array(n);
  const startStn = new Int16Array(n);
  // Per station: 5-slot ring of service durations, and trailing completions.
  const ring = new Int32Array(S * SERVICE_SAMPLES);
  const ringCount = new Uint8Array(S);
  const ringHead = new Uint8Array(S);
  const completions = new Int16Array(S);
  const serviceMean = new Float64Array(S);
  // Station of each service-end event (by event index), for the completions tail.
  let endStn: Int16Array = new Int16Array(256);

  // Cursor state: frames 0..last are counted; last = -1 means nothing yet.
  let last = -1;
  let head = 0; // first event with evTick > last
  let tpTail = 0; // first event with evTick > last - window
  let cTail = 0; // first event with evTick > last - COMPLETIONS_WINDOW
  let tpCount = 0;

  const out: Telemetry = {
    upTo: 0,
    window,
    throughput: tp.subarray(0, 0),
    stalled20: s20.subarray(0, 0),
    stalled100: s100.subarray(0, 0),
    queueLen: rec.queueLen.subarray(0, 0),
    standstill,
    serviceMean,
    completions,
    waits: new Uint16Array(0),
  };

  function reset(): void {
    last = -1;
    head = 0;
    tpTail = 0;
    cTail = 0;
    tpCount = 0;
    standstill.fill(0);
    startTick.fill(0);
    startStn.fill(-1);
    ringCount.fill(0);
    ringHead.fill(0);
    completions.fill(0);
  }
  reset();

  /** Adds frame t (t = last + 1). Reads rec fields fresh. */
  function addFrame(t: number): void {
    const evTick = rec.evTick;
    const evKind = rec.evKind;
    const evRobot = rec.evRobot;
    const evArg = rec.evArg;
    const events = rec.events;

    // Events of frame t.
    while (head < events && evTick[head] <= t) {
      const k = evKind[head];
      const r = evRobot[head];
      if (k === EKind.Deliver) {
        tpCount++;
      } else if (k === EKind.ServiceStart) {
        startTick[r] = evTick[head];
        startStn[r] = evArg[head];
      } else if (k === EKind.ServiceEnd) {
        if (head >= endStn.length) endStn = growI16(endStn, head + 1);
        const s = startStn[r];
        endStn[head] = s;
        if (s >= 0) {
          const slot = s * SERVICE_SAMPLES + ringHead[s];
          ring[slot] = evTick[head] - startTick[r];
          ringHead[s] = (ringHead[s] + 1) % SERVICE_SAMPLES;
          if (ringCount[s] < SERVICE_SAMPLES) ringCount[s]++;
          completions[s]++;
          startStn[r] = -1;
        }
      }
      head++;
    }
    while (tpTail < head && evTick[tpTail] <= t - window) {
      if (evKind[tpTail] === EKind.Deliver) tpCount--;
      tpTail++;
    }
    while (cTail < head && evTick[cTail] <= t - COMPLETIONS_WINDOW) {
      if (evKind[cTail] === EKind.ServiceEnd) {
        const s = endStn[cTail];
        if (s >= 0) completions[s]--;
      }
      cTail++;
    }

    // Standstill (D15): frame 0 is 0; a move, serving, or idle resets to 0.
    let c20 = 0;
    let c100 = 0;
    if (t > 0) {
      const positions = rec.positions;
      const states = rec.states;
      const cur = t * n;
      const prev = cur - n;
      for (let i = 0; i < n; i++) {
        const st = states[cur + i];
        if (positions[cur + i] === positions[prev + i] && st !== RState.Serving && st !== RState.Idle) {
          standstill[i]++;
        } else {
          standstill[i] = 0;
        }
        if (standstill[i] >= STANDSTILL_SHORT) c20++;
        if (standstill[i] >= STANDSTILL_LONG) c100++;
      }
    }

    if (t >= tp.length) {
      tp = growI16(tp, t + 1);
      s20 = growI16(s20, t + 1);
      s100 = growI16(s100, t + 1);
    }
    tp[t] = tpCount;
    s20[t] = c20;
    s100[t] = c100;
    last = t;
  }

  return {
    advance(upTo) {
      if (!Number.isInteger(upTo) || upTo < 0 || upTo >= rec.frames) {
        throw new RangeError(`tick ${upTo} is outside [0, ${rec.frames})`);
      }
      if (upTo < last) reset();
      for (let t = last + 1; t <= upTo; t++) addFrame(t);

      for (let s = 0; s < S; s++) {
        const c = ringCount[s];
        if (c === 0) {
          serviceMean[s] = NaN;
          continue;
        }
        let sum = 0;
        for (let k = 0; k < c; k++) sum += ring[s * SERVICE_SAMPLES + k];
        serviceMean[s] = sum / c;
      }

      out.upTo = upTo;
      out.throughput = tp.subarray(0, upTo + 1);
      out.stalled20 = s20.subarray(0, upTo + 1);
      out.stalled100 = s100.subarray(0, upTo + 1);
      out.queueLen = rec.queueLen.subarray(0, (upTo + 1) * S);
      out.waits = waitCounter.at(rec, upTo);
      return out;
    },
  };
}

/** Telemetry up to `upTo` from a fresh tracker (pure; Requirement 3.4). */
export function deriveTelemetry(rec: Recording, layout: Layout, upTo: number): Telemetry {
  return createTelemetryTracker(rec, layout).advance(upTo);
}
