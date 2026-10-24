// Hypothesis generation (Spec 3, Requirement 2): candidate faults inferred from
// Evidence only. Never reads the fault list; `config` is used for `robots` only.
// Rules and constants: design.md "Hypotheses (task 3)".

import { FAULT_PARAM_MAX, FAULT_PARAM_MIN, validateFaults } from '../sim/faults';
import type { Layout } from '../sim/layout';
import type { FaultEvent, FaultKind, SimConfig } from '../sim/types';
import type { Evidence, ObservedConfig, Service } from './types';

/** Open standstills (stalled robots) turned into permanent freezes. */
export const K_FREEZE = 4;
/** Closed standstill episodes turned into bounded freezes (longest first). */
export const K_EPISODE = 8;
/** Busy cells that went empty turned into blocked cells (most entries first). */
export const K_BLOCK = 3;
/** Hard cap on the returned list. */
export const MAX_HYPOTHESES = 40;
/** Completed services that form a station's early baseline. */
export const EARLY_SERVICES = 5;
/** Fewest completed early services needed to judge a slowdown. */
export const EARLY_MIN = 3;
/** Smallest late / early service ratio that yields a slowdown hypothesis. */
export const SLOW_RATIO_MIN = 1.5;
/** Fewest conforming moves for a slow-robot hypothesis. */
export const SLOW_MIN_MOVES = 6;

const KIND_ORDER: readonly FaultKind[] = ['robot-freeze', 'station-slowdown', 'blocked-cell', 'slow-robot'];

// ---- station services ----

/** Duration of a service; an open one counts its elapsed frames at detectedTick (a lower bound). */
function serviceDuration(s: Service, d: number): number {
  return s.end >= 0 ? s.end - s.start : d - s.start;
}

interface EarlyStats {
  /** Number of services (open or closed) at the front of the list that formed the baseline. */
  used: number;
  mean: number;
  max: number;
}

/** Mean and max of the first EARLY_SERVICES completed services, or null if fewer than EARLY_MIN. */
function earlyStats(list: readonly Service[]): EarlyStats | null {
  let count = 0;
  let sum = 0;
  let max = 0;
  let used = 0;
  for (let i = 0; i < list.length && count < EARLY_SERVICES; i++) {
    used = i + 1;
    const s = list[i];
    if (s.end < 0) continue;
    const dur = s.end - s.start;
    count++;
    sum += dur;
    if (dur > max) max = dur;
  }
  if (count < EARLY_MIN) return null;
  return { used, mean: sum / count, max };
}

/** Mean duration of services starting at or after `tick` over the early mean; 0 if none. */
function slowdownRatio(list: readonly Service[], early: EarlyStats, tick: number, d: number): number {
  let sum = 0;
  let count = 0;
  for (let i = early.used; i < list.length; i++) {
    if (list[i].start < tick) continue;
    sum += serviceDuration(list[i], d);
    count++;
  }
  return count === 0 || early.mean <= 0 ? 0 : sum / count / early.mean;
}

/**
 * Slowdown onset for one station: the first service after the baseline from
 * which every later service is long (duration > early max + 1), with at least
 * one long service. Returns the onset service start, or -1.
 */
function slowdownOnset(list: readonly Service[], early: EarlyStats, d: number): number {
  const limit = early.max + 1;
  let onset = -1;
  for (let i = list.length - 1; i >= early.used; i--) {
    if (serviceDuration(list[i], d) > limit) onset = i;
    else break;
  }
  return onset < 0 ? -1 : list[onset].start;
}

// ---- slow robots ----

/** Start of the longest suffix of `moves` divisible by `p`, and its length. */
function conformingSuffix(moves: readonly number[], p: number): { from: number; count: number } {
  let i = moves.length;
  while (i > 0 && moves[i - 1] % p === 0) i--;
  return { from: i, count: moves.length - i };
}

/** Moves at or after `tick` that fall on multiples of `p`, and whether any does not. */
function conformingSince(moves: readonly number[], p: number, tick: number): { count: number; broken: boolean } {
  let count = 0;
  let broken = false;
  for (const m of moves) {
    if (m < tick) continue;
    if (m % p === 0) count++;
    else broken = true;
  }
  return { count, broken };
}

// ---- pre-score ----

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Cheap ranking score in [0, 1] from Evidence alone (no replay). Used to keep the
 * 12 best hypotheses for counterfactual scoring (Requirement 8.1).
 * - robot-freeze, permanent: 0.6 + 0.4 * min(1, standstill frames / 200)
 * - robot-freeze, bounded:   0.2 + 0.3 * min(1, duration / 100)
 * - station-slowdown:        0.4 + 0.6 * min(1, (late / early ratio - 1) / 3)
 * - blocked-cell:            0.3 + 0.4 * min(1, entries / 40)
 * - slow-robot:              0.3 + 0.4 * min(1, conforming moves / 30), 0 if a move breaks the period
 */
export function preScore(h: FaultEvent, ev: Evidence, layout: Layout): number {
  const d = ev.detectedTick;
  switch (h.kind) {
    case 'robot-freeze':
      if (h.duration === null) return 0.6 + 0.4 * clamp01((d - h.tick + 1) / 200);
      return 0.2 + 0.3 * clamp01(h.duration / 100);
    case 'station-slowdown': {
      if (h.station < 0 || h.station >= layout.stations.length) return 0;
      const list = ev.services[h.station] ?? [];
      const early = earlyStats(list);
      if (early === null) return 0.4;
      return 0.4 + 0.6 * clamp01((slowdownRatio(list, early, h.tick, d) - 1) / 3);
    }
    case 'blocked-cell': {
      const e = ev.lastOccupied.find((x) => x.cell === h.cell);
      return 0.3 + 0.4 * clamp01((e ? e.entries : 0) / 40);
    }
    case 'slow-robot': {
      const moves = ev.moves[h.robot] ?? [];
      const c = conformingSince(moves, h.period, h.tick);
      return c.broken ? 0 : 0.3 + 0.4 * clamp01(c.count / 30);
    }
  }
}

// ---- generation ----

function targetNum(f: FaultEvent): number {
  switch (f.kind) {
    case 'robot-freeze':
    case 'slow-robot':
      return f.robot;
    case 'station-slowdown':
      return f.station;
    case 'blocked-cell':
      return f.cell;
  }
}

function paramNum(f: FaultEvent): number {
  if (f.kind === 'station-slowdown') return f.factor;
  if (f.kind === 'slow-robot') return f.period;
  return 0;
}

/** Identity key for deduplication (every field of the fault). */
function keyOf(f: FaultEvent): string {
  return `${f.kind}|${f.tick}|${targetNum(f)}|${paramNum(f)}|${f.duration === null ? 'null' : f.duration}`;
}

/** Total order: pre-score descending, then kind, target, tick, parameter, duration (null last). */
function compare(a: { f: FaultEvent; s: number }, b: { f: FaultEvent; s: number }): number {
  if (a.s !== b.s) return b.s - a.s;
  const ka = KIND_ORDER.indexOf(a.f.kind);
  const kb = KIND_ORDER.indexOf(b.f.kind);
  if (ka !== kb) return ka - kb;
  const ta = targetNum(a.f);
  const tb = targetNum(b.f);
  if (ta !== tb) return ta - tb;
  if (a.f.tick !== b.f.tick) return a.f.tick - b.f.tick;
  const pa = paramNum(a.f);
  const pb = paramNum(b.f);
  if (pa !== pb) return pa - pb;
  const da = a.f.duration === null ? Number.MAX_SAFE_INTEGER : a.f.duration;
  const db = b.f.duration === null ? Number.MAX_SAFE_INTEGER : b.f.duration;
  return da - db;
}

function isValidAlone(layout: Layout, robots: number, f: FaultEvent): boolean {
  try {
    validateFaults(layout, robots, [f]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Candidate faults from Evidence (Requirement 2). Every parameter comes from Evidence;
 * `config` contributes only `robots` (for validation). Output: deduplicated, each
 * accepted by validateFaults alone, sorted by `compare`, at most MAX_HYPOTHESES.
 */
export function generateHypotheses(ev: Evidence, layout: Layout, config: ObservedConfig | SimConfig): FaultEvent[] {
  const robots = config.robots;
  const d = ev.detectedTick;
  const raw: FaultEvent[] = [];

  // 1. Permanent freezes of the first K_FREEZE stalled robots at their standstill start.
  //    A robot serving at detectedTick is frozen one frame after its open service start
  //    (if later), so the replay still starts that service.
  for (const r of ev.stalled.slice(0, K_FREEZE)) {
    let tick = ev.standstillStart[r];
    for (const list of ev.services) {
      for (const s of list) if (s.robot === r && s.end < 0 && s.start + 1 > tick) tick = s.start + 1;
    }
    raw.push({ kind: 'robot-freeze', tick, robot: r, duration: null });
  }

  // 2. Bounded freezes from the K_EPISODE longest closed, non-serving standstill episodes.
  const closed = ev.episodes
    .filter((e) => e.end < d && !e.serving)
    .map((e) => ({ e, len: e.end - e.start + 1 }))
    .sort((a, b) => b.len - a.len || a.e.start - b.e.start || a.e.robot - b.e.robot)
    .slice(0, K_EPISODE);
  for (const { e, len } of closed) raw.push({ kind: 'robot-freeze', tick: e.start, robot: e.robot, duration: len });

  // 3. Station slowdowns: services rose to SLOW_RATIO_MIN x or more over the station's early services.
  for (let s = 0; s < ev.services.length; s++) {
    const list = ev.services[s];
    const early = earlyStats(list);
    if (early === null) continue;
    const tick = slowdownOnset(list, early, d);
    if (tick < 1) continue;
    const ratio = slowdownRatio(list, early, tick, d);
    if (ratio < SLOW_RATIO_MIN) continue;
    const factor = Math.min(FAULT_PARAM_MAX, Math.max(FAULT_PARAM_MIN, Math.round(ratio)));
    raw.push({ kind: 'station-slowdown', tick, station: s, factor, duration: null });
  }

  // 4. Blocked cells: busy cells that went empty; the block engages two frames after the last visit.
  for (const c of ev.lastOccupied.slice(0, K_BLOCK)) {
    raw.push({ kind: 'blocked-cell', tick: c.tick + 2, cell: c.cell, duration: null });
  }

  // 5. Slow robots: the largest period in [2, 4] whose conforming move suffix has SLOW_MIN_MOVES moves.
  for (let r = 0; r < ev.moves.length; r++) {
    const moves = ev.moves[r];
    for (let p = FAULT_PARAM_MAX; p >= FAULT_PARAM_MIN; p--) {
      const suf = conformingSuffix(moves, p);
      if (suf.count < SLOW_MIN_MOVES) continue;
      // Just after the last move that broke the period, else the first move of the suffix.
      const tick = suf.from > 0 ? moves[suf.from - 1] + 1 : moves[0];
      raw.push({ kind: 'slow-robot', tick, robot: r, period: p, duration: null });
      break;
    }
  }

  const seen = new Set<string>();
  const out: { f: FaultEvent; s: number }[] = [];
  for (const f of raw) {
    const k = keyOf(f);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!isValidAlone(layout, robots, f)) continue;
    out.push({ f, s: preScore(f, ev, layout) });
  }
  out.sort(compare);
  return out.slice(0, MAX_HYPOTHESES).map((x) => x.f);
}
