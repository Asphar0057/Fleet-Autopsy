import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { extractEvidence } from '../src/diagnosis/evidence';
import { generateHypotheses, preScore } from '../src/diagnosis/hypotheses';
import { observationWindow, scoreHypothesis, similarity } from '../src/diagnosis/score';
import type { ObservedConfig, Window } from '../src/diagnosis/types';
import type { Jam } from '../src/sim/jam';
import { detectJam } from '../src/sim/jam';
import type { Layout } from '../src/sim/layout';
import type { Recording } from '../src/sim/recorder';
import { SCENARIOS, scenarioConfig } from '../src/sim/scenarios';
import type { Scenario } from '../src/sim/scenarios';
import { runHeadless } from '../src/sim/sim';
import type { FaultEvent } from '../src/sim/types';
import { verifyRun } from '../src/sim/verify';
import { faultArb, faultsValid, loadPreset, oneFaultArb, seedArb } from './helpers';

/** Same kind and same robot, station, or cell. */
function sameTarget(a: FaultEvent, b: FaultEvent): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'robot-freeze':
    case 'slow-robot':
      return a.robot === (b as typeof a).robot;
    case 'station-slowdown':
      return a.station === (b as typeof a).station;
    case 'blocked-cell':
      return a.cell === (b as typeof a).cell;
  }
}

interface Curated {
  s: Scenario;
  layout: Layout;
  observed: ObservedConfig;
  rec: Recording;
  jam: Jam;
  window: Window;
}

const curatedCache = new Map<string, Curated>();

/** 2000-tick run of a curated scenario, its jam and window, memoized per file. */
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
    const observed = { seed: config.seed, robots: config.robots, queueCap: config.queueCap };
    c = { s, layout, observed, rec, jam, window: observationWindow(rec, jam) };
    curatedCache.set(id, c);
  }
  return c;
}

// ---- examples (required test 3, part 1) ----

describe('scoreHypothesis examples', () => {
  it('pd-holder-freeze: exact replay scores 1, a wrong freeze scores lower, replay is valid', () => {
    const { s, layout, observed, rec, jam, window } = curated('pd-holder-freeze');
    const primary = s.faults[0];
    expect(window.endTick).toBe(Math.min(jam.detectedTick + 200, rec.frames - 1));

    // The true fault as base (h = null) and as the hypothesis both reproduce the observation.
    const asBase = scoreHypothesis(layout, observed, null, rec, window, [primary]);
    expect(asBase.score).toBe(1);
    const asHyp = scoreHypothesis(layout, observed, primary, rec, window, []);
    expect(asHyp.score).toBe(1);
    expect(asHyp.replay.frames).toBe(window.endTick + 1);
    expect(verifyRun(asHyp.replay, layout, [primary])).toEqual([]);

    // Another robot frozen at the same tick.
    const wrong: FaultEvent = { kind: 'robot-freeze', tick: primary.tick, robot: 0, duration: null };
    const w = scoreHypothesis(layout, observed, wrong, rec, window, []);
    expect(w.replay.frames).toBe(window.endTick + 1);
    expect(verifyRun(w.replay, layout, [wrong])).toEqual([]);
    expect(w.score).toBeLessThan(1);
    expect(w.score).toBeGreaterThanOrEqual(0);

    // No fault at all also scores lower.
    const none = scoreHypothesis(layout, observed, null, rec, window, []);
    expect(none.score).toBeLessThan(1);
    console.log(`pd-holder-freeze: true 1, wrong R0 freeze ${w.score.toFixed(4)}, no fault ${none.score.toFixed(4)}`);
  }, 60_000);

  // Logs true-vs-wrong scores for the top 12 hypotheses on every curated scenario,
  // and checks the best-scoring hypothesis has the Primary's kind and target.
  for (const sc of SCENARIOS) {
    it(`${sc.id}: the Primary's hypothesis scores above every wrong one in the top 12`, () => {
      const { s, layout, observed, rec, jam, window } = curated(sc.id);
      const ev = extractEvidence(rec, layout, jam);
      const hs = generateHypotheses(ev, layout, observed).slice(0, 12);
      const primary = s.faults[s.groundTruth.primaryFaultIndex];
      const scored = hs.map((h) => ({ h, pre: preScore(h, ev, layout), score: scoreHypothesis(layout, observed, h, rec, window, []).score }));
      const truth = scored.filter((x) => sameTarget(x.h, primary));
      const wrong = scored.filter((x) => !sameTarget(x.h, primary)).sort((a, b) => b.score - a.score);
      const bestTrue = Math.max(...truth.map((x) => x.score));
      const fmt = (x: { h: FaultEvent; pre: number; score: number }) =>
        `${JSON.stringify(x.h)} pre ${x.pre.toFixed(3)} score ${x.score.toFixed(4)}`;
      console.log(
        `${s.id}: window ${window.endTick}, true [${truth.map(fmt).join('; ')}], top wrong [${wrong
          .slice(0, 3)
          .map(fmt)
          .join('; ')}], gap ${(bestTrue - (wrong[0]?.score ?? 0)).toFixed(4)}`,
      );
      expect(truth.length).toBeGreaterThan(0);
      expect(bestTrue).toBeGreaterThan(wrong[0]?.score ?? 0);
    }, 180_000);
  }
});

// ---- properties ----

interface ScoreCase {
  id: string;
  seed: number;
  robots: number;
  ticks: number;
  faults: FaultEvent[];
}

/** Run-level cases on pocket-dc and chokepoint, 300 to 600 ticks, 1 to 3 valid faults. */
const scoreCaseArb: fc.Arbitrary<ScoreCase> = fc
  .record({
    id: fc.constantFrom('pocket-dc', 'chokepoint'),
    seed: seedArb,
    ticks: fc.integer({ min: 300, max: 600 }),
  })
  .chain((b) =>
    fc.integer({ min: 2, max: loadPreset(b.id).recommendedRobots }).chain((robots) =>
      faultArb(loadPreset(b.id), robots).map((faults) => ({ ...b, robots, faults })),
    ),
  );

/** Jam from detectJam, else a synthetic one at the last frame (onset 100 ticks earlier). */
function jamFor(rec: Recording, c: ScoreCase): Jam {
  const jam = detectJam(rec, loadPreset(c.id), c.ticks);
  if (jam) return jam;
  return { onsetTick: Math.max(0, c.ticks - 100), detectedTick: c.ticks, severity: 0, signals: [] };
}

function observe(c: ScoreCase): { layout: Layout; observed: ObservedConfig; rec: Recording; window: Window } {
  const layout = loadPreset(c.id);
  const rec = runHeadless(layout, { seed: c.seed, robots: c.robots, queueCap: layout.queueCap, faults: c.faults }, c.ticks);
  return { layout, observed: { seed: c.seed, robots: c.robots, queueCap: layout.queueCap }, rec, window: observationWindow(rec, jamFor(rec, c)) };
}

describe('scoring properties', () => {
  // Feature: diagnosis, Property 5: Similarity is bounded
  // **Validates: Requirements 3.2**
  it('Property 5: Similarity is bounded', () => {
    fc.assert(
      fc.property(
        scoreCaseArb.chain((c) =>
          fc.record({
            c: fc.constant(c),
            h: fc.option(oneFaultArb(loadPreset(c.id), c.robots), { nil: null }),
            keep: fc.subarray(c.faults),
            from: fc.integer({ min: -10, max: c.ticks + 10 }),
          }),
        ),
        ({ c, h, keep, from }) => {
          const { layout, observed, rec, window } = observe(c);
          const list = h === null ? keep : [...keep, h];
          fc.pre(faultsValid(layout, c.robots, list));
          const { score, replay } = scoreHypothesis(layout, observed, h, rec, window, keep);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
          expect(replay.frames).toBe(window.endTick + 1);
          const s2 = similarity(replay, rec, window, from);
          expect(s2).toBeGreaterThanOrEqual(0);
          expect(s2).toBeLessThanOrEqual(1);
          // Deterministic.
          expect(scoreHypothesis(layout, observed, h, rec, window, keep).score).toBe(score);
        },
      ),
      { numRuns: 10 },
    );
  }, 120_000);

  // Feature: diagnosis, Property 6: Exact replay scores exactly 1
  // **Validates: Requirements 3.3**
  it('Property 6: Exact replay scores exactly 1', () => {
    fc.assert(
      fc.property(
        scoreCaseArb.chain((c) => fc.record({ c: fc.constant(c), from: fc.integer({ min: 0, max: c.ticks }) })),
        ({ c, from }) => {
          const { layout, observed, rec, window } = observe(c);
          // The world's faults as base, or the last one as the hypothesis.
          expect(scoreHypothesis(layout, observed, null, rec, window, c.faults).score).toBe(1);
          const last = c.faults[c.faults.length - 1];
          expect(scoreHypothesis(layout, observed, last, rec, window, c.faults.slice(0, -1)).score).toBe(1);
          // A recording compared with itself, for any onset.
          expect(similarity(rec, rec, window, from)).toBe(1);
        },
      ),
      { numRuns: 10 },
    );
  }, 120_000);
});
