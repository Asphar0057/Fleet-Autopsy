// Jam detector (Spec 2, Requirement 4): reads telemetry only, never faults or
// sim internals (lint-enforced). Two rules, latched on the first detection:
//   1. throughput below 60% of the Baseline for 40 consecutive ticks;
//   2. 3 or more robots with a standstill of at least 100 ticks.
// The Baseline at t is the lower median of throughput over ticks 150..t-100,
// defined once that range holds at least 100 values (t >= 349).
// Ratios are compared in integers (5·tp < 3·B, 10·tp >= 9·B) so the result is exact.

import type { Layout } from './layout';
import type { Recording } from './recorder';
import { deriveTelemetry } from './telemetry';
import type { Telemetry } from './telemetry';

export const DROP_RATIO = 0.6;
export const DROP_TICKS = 40;
export const ONSET_RATIO = 0.9;
export const STALL_ROBOTS = 3;
export const BASE_FROM = 150;
export const BASE_LAG = 100;
export const BASE_MIN = 100;

export type JamSignal = 'throughput' | 'standstill';

export interface Jam {
  onsetTick: number;
  detectedTick: number;
  /** clamp(1 - tp[upTo] / Baseline(detectedTick), 0, 1); 0 if the Baseline is undefined or 0. */
  severity: number;
  /** Every rule true at detectedTick, in the order throughput, standstill. */
  signals: JamSignal[];
}

/** tp < DROP_RATIO × base, exact for integers. */
function isDrop(tp: number, base: number): boolean {
  return 5 * tp < 3 * base;
}

/** tp >= ONSET_RATIO × base, exact for integers. */
function isHealthy(tp: number, base: number): boolean {
  return 10 * tp >= 9 * base;
}

/**
 * Baseline at tick t: lower median of throughput[150 .. t-100], or NaN when that
 * range holds fewer than 100 values. Sort-based; detectJam uses a histogram (D16).
 */
export function baselineAt(throughput: Int16Array, t: number): number {
  if (!Number.isInteger(t) || t < 0 || t >= throughput.length) {
    throw new RangeError(`tick ${t} is outside [0, ${throughput.length})`);
  }
  const end = t - BASE_LAG; // inclusive
  const count = end - BASE_FROM + 1;
  if (count < BASE_MIN) return NaN;
  const vals = throughput.slice(BASE_FROM, end + 1).sort();
  return vals[(count - 1) >> 1];
}

/** Lower median of a histogram holding `count` values. */
function histMedian(hist: Int32Array, count: number): number {
  const k = (count - 1) >> 1;
  let cum = 0;
  for (let v = 0; v < hist.length; v++) {
    cum += hist[v];
    if (cum > k) return v;
  }
  return hist.length - 1;
}

/**
 * First jam in frames 0..upTo, or null (D16, D17). Uses `tel` when given (it must
 * cover upTo, as from the UI's tracker); otherwise derives telemetry.
 * Throws RangeError for upTo outside [0, rec.frames) or telemetry that ends before upTo.
 */
export function detectJam(rec: Recording, layout: Layout, upTo: number, tel?: Telemetry): Jam | null {
  if (!Number.isInteger(upTo) || upTo < 0 || upTo >= rec.frames) {
    throw new RangeError(`tick ${upTo} is outside [0, ${rec.frames})`);
  }
  const t = tel ?? deriveTelemetry(rec, layout, upTo);
  if (t.upTo < upTo) throw new RangeError(`telemetry ends at ${t.upTo}, before tick ${upTo}`);
  const tp = t.throughput;
  const s100 = t.stalled100;

  let max = 0;
  for (let i = 0; i <= upTo; i++) if (tp[i] > max) max = tp[i];
  const hist = new Int32Array(max + 1);
  let count = 0;
  let run = 0;

  for (let i = 0; i <= upTo; i++) {
    const j = i - BASE_LAG;
    if (j >= BASE_FROM) {
      hist[tp[j]]++;
      count++;
    }
    const base = count >= BASE_MIN ? histMedian(hist, count) : -1;
    if (base >= 0 && isDrop(tp[i], base)) run++;
    else run = 0;
    const r1 = run >= DROP_TICKS;
    const r2 = s100[i] >= STALL_ROBOTS;
    if (!r1 && !r2) continue;

    const signals: JamSignal[] = [];
    if (r1) signals.push('throughput');
    if (r2) signals.push('standstill');
    if (base < 0) {
      return { onsetTick: Math.max(0, i - BASE_LAG), detectedTick: i, severity: 0, signals };
    }
    let onsetTick = 0;
    for (let u = r1 ? i - DROP_TICKS + 1 : i; u >= 0; u--) {
      if (isHealthy(tp[u], base)) {
        onsetTick = u;
        break;
      }
    }
    const severity = base === 0 ? 0 : Math.min(1, Math.max(0, 1 - tp[upTo] / base));
    return { onsetTick, detectedTick: i, severity, signals };
  }
  return null;
}
