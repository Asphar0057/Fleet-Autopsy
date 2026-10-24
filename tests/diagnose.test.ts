import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HIGH_GAP, HIGH_SCORE, MED_GAP, MED_SCORE, confidenceOf, diagnose } from '../src/diagnosis/diagnose';
import type { Diagnosis, ObservedConfig } from '../src/diagnosis/types';
import type { Jam } from '../src/sim/jam';
import { detectJam } from '../src/sim/jam';
import type { Layout } from '../src/sim/layout';
import type { Recording } from '../src/sim/recorder';
import { SCENARIOS, scenarioConfig } from '../src/sim/scenarios';
import type { Scenario } from '../src/sim/scenarios';
import { runHeadless } from '../src/sim/sim';
import type { FaultEvent } from '../src/sim/types';
import { loadPreset } from './helpers';

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
