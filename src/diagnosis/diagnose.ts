// Greedy multi-fault diagnosis (Spec 3, Requirements 4 and 8): replay the top
// hypotheses, select faults greedily by marginal Similarity gain, rank the selected
// faults by the deliveries their removal recovers, and explain each with numbers
// from Evidence and replays. Never reads the fault list of `config` (design D1).
// Steps, constants, and strings: design.md "Diagnose (task 5)", D1, D3, D4, D8, D9.

import { validateFaults } from '../sim/faults';
import type { Jam } from '../sim/jam';
import type { Layout } from '../sim/layout';
import { deliveries } from '../sim/oracle';
import type { Recording } from '../sim/recorder';
import type { FaultEvent, SimConfig } from '../sim/types';
import { targetOf } from './baselines';
import { extractEvidence } from './evidence';
import { EARLY_MIN, EARLY_SERVICES, generateHypotheses, preScore } from './hypotheses';
import { observationWindow, scoreHypothesis } from './score';
import type {
  DiagnoseOptions,
  Diagnosis,
  Evidence,
  ObservedConfig,
  RankedFault,
  ScoredHypothesis,
  Target,
} from './types';

/** Hypotheses replayed in round 1 (Requirement 8.1). */
export const PRUNE = 12;
/** Smallest marginal Similarity gain that adds a fault (Requirement 4.1). */
export const GAIN_MIN = 0.02;
/** Most faults selected (Requirement 4.1). */
export const MAX_FAULTS = 3;
/** Candidates re-scored in each round after the first (design D8). */
export const ROUND_K = 8;
/** Confidence thresholds (design "Diagnose (task 5)"). */
export const HIGH_SCORE = 0.95;
export const HIGH_GAP = 0.15;
export const MED_SCORE = 0.8;
export const MED_GAP = 0.05;

// eslint-disable-next-line no-restricted-properties -- design D4: elapsedMs only, never used in decisions
const now = (): number => performance.now();

/** Fixed thresholds on the replay score and its gap to the runner-up. */
export function confidenceOf(score: number, gap: number): RankedFault['confidence'] {
  if (score >= HIGH_SCORE && gap >= HIGH_GAP) return 'high';
  if (score >= MED_SCORE && gap >= MED_GAP) return 'medium';
  return 'low';
}

/** The AbortError thrown by `diagnose` and `diagnoseInWorker` (design "Worker (task 9)"). */
export function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('aborted', 'AbortError');
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

/** Every field of one fault, in a fixed order. */
function faultKey(f: FaultEvent): string {
  let target = 0;
  let param = 0;
  switch (f.kind) {
    case 'robot-freeze':
      target = f.robot;
      break;
    case 'slow-robot':
      target = f.robot;
      param = f.period;
      break;
    case 'station-slowdown':
      target = f.station;
      param = f.factor;
      break;
    case 'blocked-cell':
      target = f.cell;
      break;
  }
  return `${f.kind}|${f.tick}|${target}|${param}|${f.duration === null ? 'null' : f.duration}`;
}

/** Replay cache key: the ordered fault list. */
function listKey(list: readonly FaultEvent[]): string {
  return list.map(faultKey).join(';');
}

function sameTarget(a: Target, b: Target): boolean {
  return a.kind === b.kind && a.robot === b.robot && a.station === b.station && a.cell === b.cell;
}

function isValidList(layout: Layout, robots: number, list: readonly FaultEvent[]): boolean {
  try {
    validateFaults(layout, robots, list);
    return true;
  } catch {
    return false;
  }
}

// ---- evidence strings ----

function stationLabel(s: number): string {
  return `S${String(s + 1).padStart(2, '0')}`;
}

function cellLabel(c: number, layout: Layout): string {
  return `cell ${c} (${c % layout.width}, ${Math.floor(c / layout.width)})`;
}

/** First line: what the observation shows for this fault, from Evidence only. */
function observationLine(f: FaultEvent, ev: Evidence, layout: Layout): string {
  const d = ev.detectedTick;
  switch (f.kind) {
    case 'robot-freeze': {
      let cell = -1;
      if (f.duration === null) cell = ev.standstillCell[f.robot] ?? -1;
      if (cell < 0) {
        const ep = ev.episodes.find((e) => e.robot === f.robot && e.start <= f.tick && e.end >= f.tick);
        if (ep) cell = ep.cell;
      }
      const at = cell >= 0 ? ` at cell ${cell}` : '';
      const tail = f.duration === null ? `, ${d - f.tick} ticks before the alarm` : ` for ${f.duration} ticks`;
      return `R${f.robot} still${at} from tick ${f.tick}${tail}`;
    }
    case 'station-slowdown': {
      const list = ev.services[f.station] ?? [];
      let eSum = 0;
      let eCount = 0;
      let used = 0;
      for (let i = 0; i < list.length && eCount < EARLY_SERVICES; i++) {
        used = i + 1;
        if (list[i].end < 0) continue;
        eSum += list[i].end - list[i].start;
        eCount++;
      }
      let lSum = 0;
      let lCount = 0;
      for (let i = eCount >= EARLY_MIN ? used : 0; i < list.length; i++) {
        const s = list[i];
        if (s.start < f.tick) continue;
        lSum += s.end >= 0 ? s.end - s.start : d - s.start;
        lCount++;
      }
      const late = lCount > 0 ? lSum / lCount : 0;
      const head = `${stationLabel(f.station)} services ${late.toFixed(1)} ticks after tick ${f.tick}`;
      if (eCount < EARLY_MIN || eSum === 0) return head;
      const early = eSum / eCount;
      return `${head} vs ${early.toFixed(1)} early (${(late / early).toFixed(1)}x)`;
    }
    case 'blocked-cell': {
      const e = ev.lastOccupied.find((x) => x.cell === f.cell);
      const since = e ? e.tick + 1 : f.tick - 1;
      const after = e ? ` after ${e.entries} entries` : '';
      return `${cellLabel(f.cell, layout)} empty since tick ${since}${after}`;
    }
    case 'slow-robot': {
      const moves = ev.moves[f.robot] ?? [];
      let count = 0;
      for (const m of moves) if (m >= f.tick) count++;
      return `R${f.robot} moved only on multiples of ${f.period} since tick ${f.tick} (${count} moves)`;
    }
  }
}

interface Entry {
  score: number;
  deliveries: number;
}

interface Pick {
  index: number;
  score: number;
  gain: number;
  gap: number;
  /** Best other-Target score in the round, or null without a runner-up. */
  nextBest: number | null;
}

/**
 * Ranked diagnosis of a jam (Requirement 4). Reads only seed, robots, and queueCap
 * from `config`. Replays at most 1 + PRUNE + (MAX_FAULTS - 1) * ROUND_K + MAX_FAULTS
 * timelines, each restarted from tick 0 over the Observation_Window (design D5, D8).
 * Calls `onProgress` after each replay and rejects with an AbortError before the next
 * replay once `signal` is aborted. Deterministic apart from `elapsedMs` (design D4).
 */
export async function diagnose(
  layout: Layout,
  config: ObservedConfig | SimConfig,
  rec: Recording,
  jam: Jam,
  options: DiagnoseOptions = {},
): Promise<Diagnosis> {
  const observed: ObservedConfig = { seed: config.seed, robots: config.robots, queueCap: config.queueCap };
  const t0 = now();
  const n = observed.robots;

  const window = observationWindow(rec, jam);
  const evidence = extractEvidence(rec, layout, jam);
  const all = generateHypotheses(evidence, layout, observed);
  const H = all.slice(0, PRUNE);
  const targets = H.map(targetOf);

  // ---- replay cache, progress, abort ----
  const cache = new Map<string, Entry>();
  let replaysRun = 0;
  let total = 1 + H.length + (MAX_FAULTS - 1) * ROUND_K + MAX_FAULTS;
  // Progress for a replay is posted once the next step is known (just before the next
  // replay, or at the end), so `total` is a true upper bound that never grows and
  // equals `done` on the last call. The order of replays, progress calls, abort
  // checks, and yields is the same as posting right after each replay.
  let unreported = false;
  let lastH: FaultEvent | null = null;

  const report = async (remaining: number): Promise<void> => {
    if (!unreported) return;
    unreported = false;
    total = Math.min(total, replaysRun + remaining);
    options.onProgress?.(replaysRun, total, lastH);
    await Promise.resolve(); // design D3
  };

  /** Score of [...base, h] through the cache; `remaining` bounds replays left including this one. */
  const score = async (h: FaultEvent | null, base: readonly FaultEvent[], remaining: number): Promise<Entry> => {
    const key = listKey(h === null ? base : [...base, h]);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    await report(remaining);
    if (options.signal?.aborted) throw abortError();
    const r = scoreHypothesis(layout, observed, h, rec, window, base);
    const entry: Entry = { score: r.score, deliveries: deliveries(r.replay) };
    cache.set(key, entry);
    replaysRun++;
    unreported = true;
    lastH = h;
    return entry;
  };

  const futureRounds = (round: number): number => (MAX_FAULTS - round) * ROUND_K + MAX_FAULTS;

  // ---- fault-free replay ----
  const s0 = await score(null, [], 1 + H.length + futureRounds(1));
  let current = s0.score;

  /** Best of a round's scored candidates (score descending, ties by index in H), with gain and gap. */
  const pickBest = (scored: readonly { index: number; score: number }[]): Pick | null => {
    let best: { index: number; score: number } | null = null;
    for (const c of scored) {
      if (best === null || c.score > best.score || (c.score === best.score && c.index < best.index)) best = c;
    }
    if (best === null) return null;
    let nextBest: number | null = null;
    for (const c of scored) {
      if (c.index === best.index || sameTarget(targets[c.index], targets[best.index])) continue;
      if (nextBest === null || c.score > nextBest) nextBest = c.score;
    }
    const gain = best.score - current;
    return { index: best.index, score: best.score, gain, gap: nextBest === null ? gain : best.score - nextBest, nextBest };
  };

  // ---- round 1: every pruned hypothesis alone ----
  const latest: (number | null)[] = H.map(() => null);
  const round1: { index: number; score: number }[] = [];
  for (let i = 0; i < H.length; i++) {
    const e = await score(H[i], [], H.length - i + futureRounds(1));
    latest[i] = e.score;
    round1.push({ index: i, score: e.score });
  }

  const S: FaultEvent[] = [];
  const picks: Pick[] = [];
  let pick = pickBest(round1);
  if (pick !== null && pick.gain >= GAIN_MIN) {
    S.push(H[pick.index]);
    picks.push(pick);
    current = pick.score;

    // ---- rounds 2..MAX_FAULTS: ROUND_K best remaining candidates with base S ----
    for (let round = 2; round <= MAX_FAULTS; round++) {
      const candidates: number[] = [];
      for (let i = 0; i < H.length; i++) {
        if (S.includes(H[i])) continue;
        if (S.some((f) => sameTarget(targetOf(f), targets[i]))) continue;
        if (!isValidList(layout, n, [...S, H[i]])) continue;
        candidates.push(i);
      }
      candidates.sort((a, b) => (latest[b] ?? -1) - (latest[a] ?? -1) || a - b);
      const chosen = candidates.slice(0, ROUND_K);
      const scored: { index: number; score: number }[] = [];
      for (let j = 0; j < chosen.length; j++) {
        const i = chosen[j];
        const e = await score(H[i], S, chosen.length - j + futureRounds(round));
        latest[i] = e.score;
        scored.push({ index: i, score: e.score });
      }
      pick = pickBest(scored);
      if (pick === null || pick.gain < GAIN_MIN) break;
      S.push(H[pick.index]);
      picks.push(pick);
      current = pick.score;
    }
  }

  // ---- impact (D9): deliveries per 100 ticks recovered by removing each fault ----
  const ranked: RankedFault[] = [];
  if (S.length > 0) {
    const full = await score(null, S, S.length);
    for (let k = 0; k < S.length; k++) {
      const rest = S.filter((_, j) => j !== k);
      const without = await score(null, rest, S.length - k);
      const impact = window.endTick > 0 ? ((without.deliveries - full.deliveries) * 100) / window.endTick : 0;
      const p = picks[k];
      const match = `replay match ${p.score.toFixed(3)}, gain ${p.gain.toFixed(3)}`;
      ranked.push({
        fault: S[k],
        score: p.score,
        gain: p.gain,
        gap: p.gap,
        impact,
        confidence: confidenceOf(p.score, p.gap),
        evidence: [
          observationLine(S[k], evidence, layout),
          p.nextBest === null ? match : `${match}, next best ${p.nextBest.toFixed(3)}`,
          `removal recovers ${impact.toFixed(1)} deliveries / 100 ticks`,
        ],
      });
    }
  }
  await report(0);

  // ---- root cause: largest impact, then higher score, then earlier selection ----
  let rootCause: RankedFault | null = null;
  for (const f of ranked) {
    if (rootCause === null || f.impact > rootCause.impact || (f.impact === rootCause.impact && f.score > rootCause.score)) {
      rootCause = f;
    }
  }

  const hypotheses: ScoredHypothesis[] = all.map((f, i) => ({
    fault: f,
    preScore: preScore(f, evidence, layout),
    score: i < H.length ? (round1[i]?.score ?? null) : null,
  }));

  return {
    rootCause,
    faults: ranked,
    hypotheses,
    evidence,
    replaysRun,
    window,
    elapsedMs: Math.round(now() - t0),
  };
}
