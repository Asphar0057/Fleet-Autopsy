import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { extractEvidence } from '../src/diagnosis/evidence';
import { generateHypotheses, MAX_HYPOTHESES, preScore } from '../src/diagnosis/hypotheses';
import type { ObservedConfig } from '../src/diagnosis/types';
import type { Jam } from '../src/sim/jam';
import { detectJam } from '../src/sim/jam';
import type { Recording } from '../src/sim/recorder';
import { SCENARIOS, scenarioConfig } from '../src/sim/scenarios';
import { runHeadless } from '../src/sim/sim';
import type { FaultEvent } from '../src/sim/types';
import { faultArb, faultsValid, loadPreset, seedArb } from './helpers';

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

// ---- curated examples ----

describe('generateHypotheses examples', () => {
  for (const s of SCENARIOS) {
    it(`${s.id}: the Primary is a hypothesis within the top 12 by pre-score`, () => {
      const layout = loadPreset(s.layoutId);
      const config = scenarioConfig(s, layout);
      const rec = runHeadless(layout, config, 2000);
      const jam = detectJam(rec, layout, 2000);
      if (!jam) throw new Error(`${s.id}: no jam`);
      const ev = extractEvidence(rec, layout, jam);
      const observed: ObservedConfig = { seed: config.seed, robots: config.robots, queueCap: config.queueCap };
      const hs = generateHypotheses(ev, layout, observed);
      const primary = s.faults[s.groundTruth.primaryFaultIndex];
      const rank = hs.findIndex((h) => sameTarget(h, primary));
      const decoyRanks = s.groundTruth.decoyIndices.map((i) => hs.findIndex((h) => sameTarget(h, s.faults[i])));
      console.log(
        `${s.id}: ${hs.length} hypotheses, primary rank ${rank}, decoy ranks ${JSON.stringify(decoyRanks)}, top: ${hs
          .slice(0, 12)
          .map((h) => `${JSON.stringify(h)} ${preScore(h, ev, layout).toFixed(3)}`)
          .join('; ')}`,
      );
      expect(hs.length).toBeLessThanOrEqual(MAX_HYPOTHESES);
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(rank).toBeLessThan(12);
    }, 180_000);
  }
});

// ---- properties ----

interface HypCase {
  id: string;
  seed: number;
  robots: number;
  ticks: number;
  faults: FaultEvent[];
}

/** Run-level cases on pocket-dc and chokepoint, 300 to 600 ticks, 1 to 3 valid faults. */
const hypCaseArb: fc.Arbitrary<HypCase> = fc
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
function jamFor(rec: Recording, c: HypCase): Jam {
  const layout = loadPreset(c.id);
  const jam = detectJam(rec, layout, c.ticks);
  if (jam) return jam;
  return { onsetTick: Math.max(0, c.ticks - 100), detectedTick: c.ticks, severity: 0, signals: [] };
}

function keyOf(f: FaultEvent): string {
  return JSON.stringify(f, Object.keys(f).sort());
}

describe('generateHypotheses properties', () => {
  // Feature: diagnosis, Property 3: Hypotheses are well-formed
  // **Validates: Requirements 2.3**
  it('Property 3: Hypotheses are well-formed', () => {
    let total = 0;
    fc.assert(
      fc.property(hypCaseArb, (c) => {
        const layout = loadPreset(c.id);
        const config = { seed: c.seed, robots: c.robots, queueCap: layout.queueCap, faults: c.faults };
        const rec = runHeadless(layout, config, c.ticks);
        const ev = extractEvidence(rec, layout, jamFor(rec, c));
        const observed: ObservedConfig = { seed: c.seed, robots: c.robots, queueCap: layout.queueCap };
        const hs = generateHypotheses(ev, layout, observed);
        total += hs.length;

        expect(hs.length).toBeLessThanOrEqual(MAX_HYPOTHESES);
        expect(new Set(hs.map(keyOf)).size).toBe(hs.length);
        for (const h of hs) {
          expect(faultsValid(layout, c.robots, [h])).toBe(true);
          expect(h.tick).toBeLessThanOrEqual(ev.detectedTick + 2);
        }
        // Deterministic and sorted by pre-score, highest first.
        expect(generateHypotheses(ev, layout, observed)).toEqual(hs);
        const scores = hs.map((h) => preScore(h, ev, layout));
        for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
        for (const s of scores) {
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 10 },
    );
    console.log(`property 3: ${total} hypotheses over 10 runs`);
  }, 120_000);

  // Feature: diagnosis, Property 4: Hypotheses ignore the fault list
  // **Validates: Requirements 2.2, 2.4**
  it('Property 4: Hypotheses ignore the fault list', () => {
    fc.assert(
      fc.property(
        hypCaseArb.chain((c) =>
          faultArb(loadPreset(c.id), c.robots).map((other) => ({ c, other })),
        ),
        ({ c, other }) => {
          const layout = loadPreset(c.id);
          const world = { seed: c.seed, robots: c.robots, queueCap: layout.queueCap, faults: c.faults };
          const rec = runHeadless(layout, world, c.ticks);
          const ev = extractEvidence(rec, layout, jamFor(rec, c));
          const observed: ObservedConfig = { seed: c.seed, robots: c.robots, queueCap: layout.queueCap };
          const base = generateHypotheses(ev, layout, observed);
          expect(generateHypotheses(ev, layout, world)).toEqual(base);
          expect(generateHypotheses(ev, layout, { ...observed, faults: other })).toEqual(base);
          expect(generateHypotheses(ev, layout, { ...observed, faults: [] })).toEqual(base);
          // Evidence is the only input: a copy round-tripped through JSON gives the same list.
          const copy = JSON.parse(JSON.stringify(ev)) as typeof ev;
          expect(generateHypotheses(copy, layout, observed)).toEqual(base);
          expect(faultsValid(layout, c.robots, other)).toBe(true);
        },
      ),
      { numRuns: 10 },
    );
  }, 120_000);
});
