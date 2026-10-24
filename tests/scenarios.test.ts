import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeRecovered, deliveries, isValid, scoreFaults } from '../src/sim/oracle';
import type { OracleResult } from '../src/sim/oracle';
import { runHeadless } from '../src/sim/sim';
import type { FaultEvent, GroundTruth, SimConfig } from '../src/sim/types';
import { loadPreset } from './helpers';

describe('scoreFaults', () => {
  it('a single-fault config recovers exactly 1 (the removed run is the baseline)', () => {
    const layout = loadPreset('pocket-dc');
    const fault: FaultEvent = { kind: 'station-slowdown', tick: 50, station: 0, factor: 4, duration: null };
    const config: SimConfig = { seed: 1, robots: layout.recommendedRobots, queueCap: layout.queueCap, faults: [fault] };
    const r = scoreFaults(layout, config);
    expect(r.baseline).toBe(deliveries(runHeadless(layout, { ...config, faults: [] }, 2000)));
    expect(r.baseline).toBeGreaterThan(r.withAll);
    expect(r.without[0]).toBe(r.baseline);
    expect(r.recovered[0]).toBe(1);
  });

  it('gives every fraction 0 when the faults cost nothing', () => {
    expect(computeRecovered(10, 10, [12, 9])).toEqual([0, 0]);
    expect(computeRecovered(10, 12, [10])).toEqual([0]);
  });
});

/** Baseline, with-all, without-counts, and a ground truth over those faults. */
const caseArb = fc
  .record({
    baseline: fc.integer({ min: 0, max: 60 }),
    withAll: fc.integer({ min: 0, max: 60 }),
    without: fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 1, maxLength: 4 }),
  })
  .chain((c) =>
    fc.integer({ min: 0, max: c.without.length - 1 }).chain((p) => {
      const others = [...c.without.keys()].filter((i) => i !== p);
      return fc.record({
        c: fc.constant(c),
        gt: fc.record({
          primaryFaultIndex: fc.constant(p),
          decoyIndices: others.length > 0 ? fc.subarray(others) : fc.constant<number[]>([]),
        }),
      });
    }),
  );

/** Independent reference: integer cross-multiplication, no division. */
function referenceValid(b: number, w: number, without: number[], gt: GroundTruth): boolean {
  const gap = b - w;
  if (gap <= 0 || 10 * gap < b) return false;
  if (10 * (without[gt.primaryFaultIndex] - w) < 7 * gap) return false;
  return gt.decoyIndices.every((d) => 10 * (without[d] - w) < gap);
}

describe('oracle validity property', () => {
  // Feature: failures-telemetry, Property 11: Validity rule matches its formula
  // **Validates: Requirements 6.2**
  it('Property 11: Validity rule matches its formula', () => {
    fc.assert(
      fc.property(caseArb, ({ c, gt }) => {
        const r: OracleResult = { ...c, recovered: computeRecovered(c.baseline, c.withAll, c.without) };
        return isValid(r, gt) === referenceValid(c.baseline, c.withAll, c.without, gt);
      }),
      { numRuns: 100 },
    );
  });
});
