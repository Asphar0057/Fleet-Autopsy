// Pure helpers for the landing jam backdrop (Backdrop.tsx). No DOM.
import type { FaultEvent } from '../../sim/types';

/** Curated scenario the backdrop plays: Pocket DC · decoy, then frozen holder. */
export const BACKDROP_SCENARIO = 'pd-decoy-first';
/** Last tick played; the frame is held there. */
export const END_TICK = 900;
/** Playback speed relative to the app's 1x. */
export const SPEED = 3;

/** Ripples: count, period and stagger (ms), radius range in cells, start opacity. */
export const RINGS = 7;
export const RING_MS = 7000;
export const RING_GAP_MS = 1000;
export const RING_R0 = 0.5;
export const RING_R1 = 5.5;
export const RING_ALPHA = 0.6;
/** Glow radius in cells. */
export const GLOW_R = 4.5;
/** Reduced motion: three still rings as (radius fraction, opacity). */
export const STATIC_RINGS: readonly (readonly [number, number])[] = [
  [0.2, 0.55],
  [0.45, 0.3],
  [0.75, 0.15],
];

export interface Culprit {
  robot: number;
  tick: number;
}

/** The scenario's primary fault, if it is a robot fault: its robot and start tick. */
export function backdropCulprit(faults: readonly FaultEvent[], primary: number): Culprit | null {
  const f = faults[primary];
  if (!f || (f.kind !== 'robot-freeze' && f.kind !== 'slow-robot')) return null;
  return { robot: f.robot, tick: f.tick };
}

/** Radius (cells) and opacity of ring `i` at `ms` since the ripples started; null before it fires. */
export function ringAt(ms: number, i: number): { r: number; alpha: number } | null {
  const age = ms - i * RING_GAP_MS;
  if (age < 0) return null;
  const p = (age % RING_MS) / RING_MS;
  const eased = 1 - (1 - p) * (1 - p) * (1 - p); // ease-out
  return { r: RING_R0 + (RING_R1 - RING_R0) * eased, alpha: RING_ALPHA * (1 - p) };
}

/** The three still rings shown under reduced motion. */
export function staticRings(): { r: number; alpha: number }[] {
  return STATIC_RINGS.map(([f, alpha]) => ({ r: RING_R0 + (RING_R1 - RING_R0) * f, alpha }));
}
