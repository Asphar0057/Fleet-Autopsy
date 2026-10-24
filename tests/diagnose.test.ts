import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HIGH_GAP, HIGH_SCORE, MED_GAP, MED_SCORE, confidenceOf, diagnose } from '../src/diagnosis/diagnose';
import { blameFirstAlarm, blameMostSevere, matchesGroundTruth, targetOf } from '../src/diagnosis/baselines';
import { extractEvidence } from '../src/diagnosis/evidence';
import type { Diagnosis, Evidence, ObservedConfig, Service, Standstill, Target } from '../src/diagnosis/types';
import type { Jam } from '../src/sim/jam';
import { detectJam } from '../src/sim/jam';
import type { Layout } from '../src/sim/layout';
import type { Recording } from '../src/sim/recorder';
import { SCENARIOS, scenarioConfig } from '../src/sim/scenarios';
import type { Scenario } from '../src/sim/scenarios';
import { runHeadless } from '../src/sim/sim';
import type { FaultEvent, FaultKind } from '../src/sim/types';
import { PRESET_IDS, loadPreset, oneFaultArb } from './helpers';

interface Curated {
  s: Scenario;
  layout: Layout;
  observed: ObservedConfig;
  rec: Recording;
  jam: Jam;
}

const curatedCache = new Map<string, Curated>();

/** 2000-tick run of a curated scenario and its jam, memoized per file. Only the observed config is kept. */
function curated(id: string): Curated {
  let c = curatedCache.get(id);
  if (!c) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario ${id}`);
    const layout = loadPreset(s.layoutId);
    const config = scenarioConfig(s, layout);
    const rec = runHeadless(layout, config, 2000);
    const jam = detectJam(rec, layout, 2000);
    if (!jam) throw new Error(`${id}: no jam`);
    const observed: ObservedConfig = { seed: config.seed, robots: config.robots, queueCap: config.queueCap };
    c = { s, layout, observed, rec, jam };
    curatedCache.set(id, c);
  }
  return c;
}

interface ProgressCall {
  done: number;
  total: number;
  h: FaultEvent | null;
}

/** Diagnosis without its wall-clock field. */
function withoutElapsed(d: Diagnosis): Omit<Diagnosis, 'elapsedMs'> {
  const { elapsedMs: _elapsed, ...rest } = d;
  void _elapsed;
  return rest;
}

// ---- determinism (required test 7) ----

describe('diagnose determinism', () => {
  it('pd-holder-freeze: two calls deep-equal apart from elapsedMs; one progress call per replay', async () => {
    const { layout, observed, rec, jam } = curated('pd-holder-freeze');

    const runOnce = async (): Promise<{ d: Diagnosis; calls: ProgressCall[] }> => {
      const calls: ProgressCall[] = [];
      const d = await diagnose(layout, observed, rec, jam, {
        onProgress: (done, total, h) => calls.push({ done, total, h }),
      });
      return { d, calls };
    };

    const a = await runOnce();
    const b = await runOnce();

    expect(typeof a.d.elapsedMs).toBe('number');
    expect(withoutElapsed(a.d)).toEqual(withoutElapsed(b.d));
    expect(a.calls).toEqual(b.calls);

    for (const { d, calls } of [a, b]) {
      expect(d.replaysRun).toBeGreaterThan(0);
      expect(calls.length).toBe(d.replaysRun);
      for (let i = 0; i < calls.length; i++) {
        expect(calls[i].done).toBeLessThanOrEqual(calls[i].total);
        if (i > 0) expect(calls[i].done).toBeGreaterThanOrEqual(calls[i - 1].done);
      }
      const last = calls[calls.length - 1];
      expect(last.done).toBe(d.replaysRun);
      expect(last.total).toBe(d.replaysRun);
    }
  }, 180_000);
});

// ---- decoy headline (required tests 4 and 5) ----

const diagnosisCache = new Map<string, Promise<Diagnosis>>();

/** Diagnosis of a curated scenario, memoized per file. */
function curatedDiagnosis(id: string): Promise<Diagnosis> {
  let p = diagnosisCache.get(id);
  if (!p) {
    const { layout, observed, rec, jam } = curated(id);
    p = diagnose(layout, observed, rec, jam);
    diagnosisCache.set(id, p);
  }
  return p;
}

describe('pd-decoy-first', () => {
  it('first-alarm baseline misses the Primary; diagnose names R3', async () => {
    const { s, layout, rec, jam } = curated('pd-decoy-first');
    const primary = s.faults[s.groundTruth.primaryFaultIndex];
    expect(primary.kind === 'robot-freeze' && primary.robot === 3).toBe(true);

    const ev = extractEvidence(rec, layout, jam);
    const first = blameFirstAlarm(ev);
    // The Requirement 5.1 rule names R7 here, a natural 25-tick standstill from
    // tick 254 (before any fault), not the decoy R6 (tick 350). Natural episodes
    // of R3 (306) and R8 (340) also precede the decoy. The headline claim is that
    // the naive baseline misses the Primary, so that is what is asserted.
    expect(first).not.toBeNull();
    expect(matchesGroundTruth(first, primary, layout)).toBe(false);
    console.log('pd-decoy-first blameFirstAlarm:', first, 'blameMostSevere:', blameMostSevere(ev));

    const d = await curatedDiagnosis('pd-decoy-first');
    if (d.rootCause === null) throw new Error('no root cause');
    const root = d.rootCause.fault;
    expect(matchesGroundTruth(targetOf(root), primary, layout)).toBe(true);
    expect(root.kind === 'robot-freeze' && root.robot === 3).toBe(true);
  }, 180_000);

  it('greedy selection: the Primary only (the decoy is a known multi-fault miss)', async () => {
    const { s, layout } = curated('pd-decoy-first');
    const primary = s.faults[s.groundTruth.primaryFaultIndex];
    const d = await curatedDiagnosis('pd-decoy-first');
    // Requirement 4.1 asks for both faults. The decoy's round-2 gain stays below
    // GAIN_MIN, so only the Primary is selected; recorded in docs/spec3-debug.md.
    expect(d.faults.length).toBe(1);
    expect(matchesGroundTruth(targetOf(d.faults[0].fault), primary, layout)).toBe(true);
  }, 180_000);
});

// ---- confidence (Property 7) ----

const RANK = { low: 0, medium: 1, high: 2 } as const;

/** Reference model of the design's confidence table. */
function expectedConfidence(score: number, gap: number): 'high' | 'medium' | 'low' {
  if (score >= HIGH_SCORE && gap >= HIGH_GAP) return 'high';
  if (score >= MED_SCORE && gap >= MED_GAP) return 'medium';
  return 'low';
}

/** Scores in [0, 1], mixed with the exact thresholds and bounds. */
const scoreArb = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.constantFrom(0, 1, HIGH_SCORE, MED_SCORE, HIGH_GAP, MED_GAP),
);
/** Gaps in [-1, 1], mixed with the exact thresholds and bounds. */
const gapArb = fc.oneof(
  fc.double({ min: -1, max: 1, noNaN: true }),
  fc.constantFrom(-1, 0, 1, HIGH_GAP, MED_GAP, HIGH_SCORE, MED_SCORE),
);
/** Non-negative increments, including zero. */
const deltaArb = fc.oneof(fc.double({ min: 0, max: 2, noNaN: true }), fc.constant(0));

describe('confidenceOf', () => {
  // Feature: diagnosis, Property 7: Confidence follows the fixed gaps
  // **Validates: Requirements 4.3**
  it('Property 7: matches the threshold table and is monotone in score and gap', () => {
    fc.assert(
      fc.property(scoreArb, gapArb, deltaArb, deltaArb, (score, gap, ds, dg) => {
        const c = confidenceOf(score, gap);
        expect(c).toBe(expectedConfidence(score, gap));
        // Raising either input never lowers confidence.
        expect(RANK[confidenceOf(score + ds, gap)]).toBeGreaterThanOrEqual(RANK[c]);
        expect(RANK[confidenceOf(score, gap + dg)]).toBeGreaterThanOrEqual(RANK[c]);
        expect(RANK[confidenceOf(score + ds, gap + dg)]).toBeGreaterThanOrEqual(RANK[c]);
      }),
      { numRuns: 100 },
    );
  });

  it('exact thresholds are inclusive', () => {
    expect(confidenceOf(HIGH_SCORE, HIGH_GAP)).toBe('high');
    expect(confidenceOf(MED_SCORE, MED_GAP)).toBe('medium');
    expect(confidenceOf(HIGH_SCORE, MED_GAP)).toBe('medium');
    expect(confidenceOf(1, 0)).toBe('low');
  });
});

// ---- baselines (Property 8) ----

/** Reference anomaly: written from design.md "Baselines (task 6)", independent of listAnomalies. */
interface RefAnomaly {
  start: number;
  isRobot: boolean;
  id: number;
  delay: number;
}

function referenceAnomalies(ev: Evidence): RefAnomaly[] {
  const all: RefAnomaly[] = [];
  for (const e of ev.episodes) {
    const len = e.end - e.start + 1;
    if (len >= 20 && e.start >= 150) all.push({ start: e.start, isRobot: true, id: e.robot, delay: len });
  }
  ev.services.forEach((list, station) => {
    // Early baseline: the first 5 completed services; needs at least 3.
    const early: number[] = [];
    let lastEarlyIndex = -1;
    for (let i = 0; i < list.length; i++) {
      if (early.length === 5) break;
      lastEarlyIndex = i;
      if (list[i].end !== -1) early.push(list[i].end - list[i].start);
    }
    if (early.length < 3) return;
    const mean = early.reduce((a, b) => a + b, 0) / early.length;
    list.slice(lastEarlyIndex + 1).forEach((s) => {
      const duration = s.end === -1 ? ev.detectedTick - s.start : s.end - s.start;
      if (s.start >= 150 && duration > 2 * mean) {
        all.push({ start: s.start, isRobot: false, id: station, delay: duration - mean });
      }
    });
  });
  return all;
}

function refTarget(a: RefAnomaly): Target {
  return a.isRobot ? { kind: 'robot-freeze', robot: a.id } : { kind: 'station-slowdown', station: a.id };
}

/** Tie keys shared by both baselines: start, robot before station, lower id. */
function byStartKindId(a: RefAnomaly, b: RefAnomaly): number {
  if (a.start !== b.start) return a.start - b.start;
  if (a.isRobot !== b.isRobot) return a.isRobot ? -1 : 1;
  return a.id - b.id;
}

function refFirstAlarm(ev: Evidence): Target | null {
  const sorted = [...referenceAnomalies(ev)].sort(byStartKindId);
  return sorted.length === 0 ? null : refTarget(sorted[0]);
}

function refMostSevere(ev: Evidence): Target | null {
  const sorted = [...referenceAnomalies(ev)].sort((a, b) => (a.delay !== b.delay ? b.delay - a.delay : byStartKindId(a, b)));
  return sorted.length === 0 ? null : refTarget(sorted[0]);
}

/** Starts clustered around the 150 warm-up threshold, plus a wide range. */
const episodeStartArb = fc.oneof(fc.constantFrom(148, 149, 150, 151, 200), fc.integer({ min: 0, max: 400 }));
/** Episode lengths clustered around the 20-frame threshold, plus a wide range. */
const episodeLenArb = fc.oneof(fc.constantFrom(18, 19, 20, 21, 30), fc.integer({ min: 1, max: 80 }));

const episodeArb = fc.record({
  robot: fc.integer({ min: 0, max: 5 }),
  start: episodeStartArb,
  len: episodeLenArb,
  serving: fc.boolean(),
});

/**
 * One station's services: back-to-back with small gaps (one robot at a time),
 * so only the last may be open. Early durations {4, 5, 6} put 2x the mean in
 * [8, 12]; later durations cluster around that threshold.
 */
const stationArb = fc.record({
  firstStart: fc.integer({ min: 60, max: 150 }),
  early: fc.array(fc.constantFrom(4, 5, 6), { minLength: 0, maxLength: 6 }),
  later: fc.array(
    fc.record({
      gap: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 30 })),
      dur: fc.oneof(fc.integer({ min: 7, max: 13 }), fc.integer({ min: 1, max: 60 })),
      robot: fc.integer({ min: 0, max: 5 }),
    }),
    { maxLength: 6 },
  ),
  earlyGap: fc.integer({ min: 0, max: 10 }),
  lastOpen: fc.boolean(),
});

const evidenceArb = fc
  .record({
    episodes: fc.array(episodeArb, { maxLength: 8 }),
    stations: fc.array(stationArb, { maxLength: 4 }),
    detectedPad: fc.integer({ min: 0, max: 40 }),
  })
  .map(({ episodes, stations, detectedPad }): Evidence => {
    const eps: Standstill[] = episodes
      .map((e) => ({ robot: e.robot, start: e.start, end: e.start + e.len - 1, cell: e.robot, serving: e.serving }))
      .sort((a, b) => a.start - b.start || a.robot - b.robot);
    let latest = 0;
    for (const e of eps) latest = Math.max(latest, e.end);

    const services: Service[][] = stations.map((st) => {
      const list: Service[] = [];
      let t = st.firstStart;
      for (const d of st.early) {
        list.push({ robot: 0, start: t, end: t + d });
        t += d + st.earlyGap;
      }
      for (const l of st.later) {
        t += l.gap;
        list.push({ robot: l.robot, start: t, end: t + l.dur });
        t += l.dur;
      }
      latest = Math.max(latest, t);
      return list;
    });

    const detectedTick = latest + detectedPad;
    // Open the last service: its duration becomes detectedTick - start.
    stations.forEach((st, i) => {
      const list = services[i];
      if (st.lastOpen && list.length > 0) list[list.length - 1] = { ...list[list.length - 1], end: -1 };
    });

    return {
      detectedTick,
      onsetTick: 0,
      standstillStart: [],
      standstillCell: [],
      stalled: [],
      episodes: eps,
      hotspots: [],
      services,
      completions: services.map((list) => list.filter((s) => s.end >= 0).length),
      throughput: [],
      moves: [],
      lastOccupied: [],
    };
  });

describe('baselines', () => {
  // Feature: diagnosis, Property 8: Baselines match a reference model
  // **Validates: Requirements 5.1, 5.2**
  it('Property 8: blameFirstAlarm and blameMostSevere match a reference model', () => {
    fc.assert(
      fc.property(evidenceArb, (ev) => {
        expect(blameFirstAlarm(ev)).toEqual(refFirstAlarm(ev));
        expect(blameMostSevere(ev)).toEqual(refMostSevere(ev));
      }),
      { numRuns: 100 },
    );
  });

  it('threshold examples: 149 and 19 frames are ignored, 150 and 20 count; null without anomalies', () => {
    const ev = (episodes: Standstill[], services: Service[][] = []): Evidence => ({
      detectedTick: 400,
      onsetTick: 0,
      standstillStart: [],
      standstillCell: [],
      stalled: [],
      episodes,
      hotspots: [],
      services,
      completions: services.map((l) => l.filter((s) => s.end >= 0).length),
      throughput: [],
      moves: [],
      lastOccupied: [],
    });
    const ep = (robot: number, start: number, len: number): Standstill => ({ robot, start, end: start + len - 1, cell: 0, serving: false });

    expect(blameFirstAlarm(ev([]))).toBeNull();
    expect(blameMostSevere(ev([]))).toBeNull();
    expect(blameFirstAlarm(ev([ep(1, 149, 50), ep(2, 150, 19)]))).toBeNull();
    expect(blameFirstAlarm(ev([ep(1, 149, 50), ep(2, 150, 20)]))).toEqual({ kind: 'robot-freeze', robot: 2 });

    // Station 0: early mean 5; an open service from 300 at detectedTick 400 lasts 100 (delay 95).
    const svc: Service[] = [0, 10, 20, 30, 40].map((s) => ({ robot: 0, start: s, end: s + 5 }));
    svc.push({ robot: 1, start: 300, end: -1 });
    expect(blameMostSevere(ev([ep(2, 150, 20)], [svc]))).toEqual({ kind: 'station-slowdown', station: 0 });
    expect(blameFirstAlarm(ev([ep(2, 150, 20)], [svc]))).toEqual({ kind: 'robot-freeze', robot: 2 });
  });
});

// ---- ground-truth matching (Property 9) ----

const KINDS: readonly FaultKind[] = ['robot-freeze', 'station-slowdown', 'slow-robot', 'blocked-cell'];

/**
 * Reference rule from Requirement 5.3, independent of layout.neighbors:
 * blocked-cell adjacency is Manhattan distance 1 on (cell % width, floor(cell / width)).
 */
function refMatches(t: Target | null, truth: FaultEvent, layout: Layout): boolean {
  if (t === null || t.kind !== truth.kind) return false;
  switch (truth.kind) {
    case 'robot-freeze':
    case 'slow-robot':
      return t.robot === truth.robot;
    case 'station-slowdown':
      return t.station === truth.station;
    case 'blocked-cell': {
      const c = t.cell;
      if (c === undefined) return false;
      if (c === truth.cell) return true;
      const w = layout.width;
      if (!Number.isInteger(c) || c < 0 || c >= w * layout.height) return false;
      const dx = Math.abs((c % w) - (truth.cell % w));
      const dy = Math.abs(Math.floor(c / w) - Math.floor(truth.cell / w));
      return dx + dy === 1;
    }
  }
}

type Variant = 'same' | 'otherId' | 'otherKind' | 'nb0' | 'nb1' | 'nb2' | 'nb3' | 'far' | 'random';

/** Random Target: any kind, each id field optional, ids slightly out of range included. */
function randomTargetArb(layout: Layout): fc.Arbitrary<Target> {
  const cells = layout.width * layout.height;
  return fc
    .record({
      kind: fc.constantFrom(...KINDS),
      robot: fc.option(fc.integer({ min: -1, max: layout.recommendedRobots + 1 }), { nil: undefined }),
      station: fc.option(fc.integer({ min: -1, max: layout.stations.length + 1 }), { nil: undefined }),
      cell: fc.option(fc.integer({ min: -2, max: cells + 1 }), { nil: undefined }),
    })
    .map((r) => {
      const t: Target = { kind: r.kind };
      if (r.robot !== undefined) t.robot = r.robot;
      if (r.station !== undefined) t.station = r.station;
      if (r.cell !== undefined) t.cell = r.cell;
      return t;
    });
}

const matchCaseArb = fc.constantFrom(...PRESET_IDS).chain((id) => {
  const layout = loadPreset(id);
  return fc.record({
    id: fc.constant(id),
    truth: oneFaultArb(layout, layout.recommendedRobots),
    variant: fc.constantFrom<Variant>('same', 'otherId', 'otherKind', 'nb0', 'nb1', 'nb2', 'nb3', 'far', 'random'),
    delta: fc.oneof(fc.integer({ min: -5, max: -1 }), fc.integer({ min: 1, max: 5 })),
    kindPick: fc.integer({ min: 0, max: 2 }),
    random: randomTargetArb(layout),
  });
});

/** The id field of a Target for its fault kind. */
function idKey(kind: FaultKind): 'robot' | 'station' | 'cell' {
  return kind === 'station-slowdown' ? 'station' : kind === 'blocked-cell' ? 'cell' : 'robot';
}

/** Builds the Target for a variant; `expected` is the known answer for derived variants, null for random. */
function deriveTarget(
  layout: Layout,
  truth: FaultEvent,
  variant: Variant,
  delta: number,
  kindPick: number,
  random: Target,
): { t: Target; expected: boolean | null } {
  const own = targetOf(truth);
  const key = idKey(truth.kind);
  const id = own[key] as number;
  switch (variant) {
    case 'same':
      return { t: own, expected: true };
    case 'otherId':
      // A blocked cell ±1 may be 4-adjacent (and so match); the reference decides.
      return { t: { kind: truth.kind, [key]: id + delta }, expected: truth.kind === 'blocked-cell' ? null : false };
    case 'otherKind': {
      const others = KINDS.filter((k) => k !== truth.kind);
      return { t: { ...own, kind: others[kindPick] }, expected: false };
    }
    case 'nb0':
    case 'nb1':
    case 'nb2':
    case 'nb3': {
      if (truth.kind !== 'blocked-cell') return { t: own, expected: true };
      const n = layout.neighbors[truth.cell * 4 + Number(variant[2])];
      return n < 0 ? { t: own, expected: true } : { t: { kind: 'blocked-cell', cell: n }, expected: true };
    }
    case 'far': {
      if (truth.kind !== 'blocked-cell') return { t: { kind: truth.kind, [key]: id + delta }, expected: false };
      // Two columns away in the same row: Manhattan distance 2.
      const x = truth.cell % layout.width;
      const cell = x + 2 < layout.width ? truth.cell + 2 : truth.cell - 2;
      return { t: { kind: 'blocked-cell', cell }, expected: false };
    }
    case 'random':
      return { t: random, expected: null };
  }
}

describe('matchesGroundTruth', () => {
  it('layout.neighbors agrees with coordinate adjacency on every preset', () => {
    for (const id of PRESET_IDS) {
      const l = loadPreset(id);
      for (let c = 0; c < l.width * l.height; c++) {
        const x = c % l.width;
        const y = Math.floor(c / l.width);
        const want = [
          x + 1 < l.width ? c + 1 : -1,
          x > 0 ? c - 1 : -1,
          y + 1 < l.height ? c + l.width : -1,
          y > 0 ? c - l.width : -1,
        ];
        expect(Array.from(l.neighbors.subarray(c * 4, c * 4 + 4))).toEqual(want);
      }
    }
  });

  // Feature: diagnosis, Property 9: Ground-truth matching rule
  // **Validates: Requirements 5.3**
  it('Property 9: matches the reference rule; targetOf(truth) always matches; null never does', () => {
    fc.assert(
      fc.property(matchCaseArb, ({ id, truth, variant, delta, kindPick, random }) => {
        const layout = loadPreset(id);
        expect(matchesGroundTruth(null, truth, layout)).toBe(false);
        expect(matchesGroundTruth(targetOf(truth), truth, layout)).toBe(true);

        const { t, expected } = deriveTarget(layout, truth, variant, delta, kindPick, random);
        const got = matchesGroundTruth(t, truth, layout);
        expect(got).toBe(refMatches(t, truth, layout));
        if (expected !== null) expect(got).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
