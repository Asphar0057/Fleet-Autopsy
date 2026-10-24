// Naive baselines and ground-truth matching (Spec 3, Requirement 5).
// Pure functions of Evidence and fault values; never reads a fault list.
// Rules: design.md "Baselines (task 6)".

import type { Layout } from '../sim/layout';
import type { FaultEvent } from '../sim/types';
import { EARLY_MIN, EARLY_SERVICES } from './hypotheses';
import type { Evidence, Service, Target } from './types';

/** Anomalies starting before this tick are ignored (warm-up). */
export const ALARM_MIN_START = 150;
/** Shortest standstill episode (frames) that counts as a robot anomaly. */
export const ALARM_MIN_STANDSTILL = 20;
/** A service longer than this multiple of the station's early mean is an anomaly. */
export const ALARM_SERVICE_RATIO = 2;

export interface Anomaly {
  start: number;
  target: Target;
  /** Delay ticks: standstill length, or service duration minus the early mean. */
  delay: number;
}

/** Early baseline: mean of the first EARLY_SERVICES completed services and how many list entries it consumed. */
function earlyBaseline(list: readonly Service[]): { used: number; mean: number } | null {
  let count = 0;
  let sum = 0;
  let used = 0;
  for (let i = 0; i < list.length && count < EARLY_SERVICES; i++) {
    used = i + 1;
    const s = list[i];
    if (s.end < 0) continue;
    count++;
    sum += s.end - s.start;
  }
  return count < EARLY_MIN ? null : { used, mean: sum / count };
}

/**
 * Every anomaly in Evidence: robot standstill episodes of at least 20 frames
 * and station services longer than 2x the early mean, both starting at or
 * after tick 150. Robots first (episode order), then stations by index.
 */
export function listAnomalies(ev: Evidence): Anomaly[] {
  const out: Anomaly[] = [];
  for (const e of ev.episodes) {
    const len = e.end - e.start + 1;
    if (len < ALARM_MIN_STANDSTILL || e.start < ALARM_MIN_START) continue;
    out.push({ start: e.start, target: { kind: 'robot-freeze', robot: e.robot }, delay: len });
  }
  for (let st = 0; st < ev.services.length; st++) {
    const list = ev.services[st];
    const early = earlyBaseline(list);
    if (early === null) continue;
    for (let i = early.used; i < list.length; i++) {
      const s = list[i];
      if (s.start < ALARM_MIN_START) continue;
      const dur = s.end >= 0 ? s.end - s.start : ev.detectedTick - s.start;
      if (dur <= ALARM_SERVICE_RATIO * early.mean) continue;
      out.push({ start: s.start, target: { kind: 'station-slowdown', station: st }, delay: dur - early.mean });
    }
  }
  return out;
}

/** 0 for robot anomalies, 1 for station anomalies. */
function kindRank(a: Anomaly): number {
  return a.target.kind === 'robot-freeze' ? 0 : 1;
}

function idOf(a: Anomaly): number {
  return a.target.robot ?? a.target.station ?? -1;
}

/** Earliest anomaly; ties: robot before station, then lower id. Null without anomalies. */
export function blameFirstAlarm(ev: Evidence): Target | null {
  let best: Anomaly | null = null;
  for (const a of listAnomalies(ev)) {
    if (
      best === null ||
      a.start < best.start ||
      (a.start === best.start && (kindRank(a) < kindRank(best) || (kindRank(a) === kindRank(best) && idOf(a) < idOf(best))))
    ) {
      best = a;
    }
  }
  return best === null ? null : { ...best.target };
}

/** Anomaly with the most delay ticks; ties: smaller start, robot before station, lower id. Null without anomalies. */
export function blameMostSevere(ev: Evidence): Target | null {
  let best: Anomaly | null = null;
  for (const a of listAnomalies(ev)) {
    if (best === null || compareSevere(a, best) < 0) best = a;
  }
  return best === null ? null : { ...best.target };
}

function compareSevere(a: Anomaly, b: Anomaly): number {
  if (a.delay !== b.delay) return b.delay - a.delay;
  if (a.start !== b.start) return a.start - b.start;
  if (kindRank(a) !== kindRank(b)) return kindRank(a) - kindRank(b);
  return idOf(a) - idOf(b);
}

/**
 * True exactly when `t` names the same kind and target as `truth`; for
 * blocked-cell, the cell may also be 4-adjacent (layout.neighbors, E W S N).
 * Never matches null.
 */
export function matchesGroundTruth(t: Target | null, truth: FaultEvent, layout: Layout): boolean {
  if (t === null || t.kind !== truth.kind) return false;
  switch (truth.kind) {
    case 'robot-freeze':
    case 'slow-robot':
      return t.robot === truth.robot;
    case 'station-slowdown':
      return t.station === truth.station;
    case 'blocked-cell': {
      if (t.cell === undefined) return false;
      if (t.cell === truth.cell) return true;
      for (let k = 0; k < 4; k++) {
        const n = layout.neighbors[truth.cell * 4 + k];
        if (n >= 0 && n === t.cell) return true;
      }
      return false;
    }
  }
}

/** The Target of a fault: its kind plus only its robot, station, or cell. */
export function targetOf(f: FaultEvent): Target {
  switch (f.kind) {
    case 'robot-freeze':
    case 'slow-robot':
      return { kind: f.kind, robot: f.robot };
    case 'station-slowdown':
      return { kind: f.kind, station: f.station };
    case 'blocked-cell':
      return { kind: f.kind, cell: f.cell };
  }
}
