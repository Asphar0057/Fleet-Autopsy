import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mulberry32, randInt } from '../src/sim/rng';
import { hashRecording } from '../src/sim/recorder';
import { faultArb, loadPreset, runCase, runCaseArb, seedArb } from './helpers';

const RUN_TICKS = 300;

describe('sim determinism (required test 1)', () => {
  it('same layout, config, and seed give identical recordings; a different seed differs', () => {
    const base = { id: 'fulfillment-block', seed: 42, robots: 36 };
    const a = runCase(base, 500).recording;
    const b = runCase(base, 500).recording;
    const c = runCase({ ...base, seed: 43 }, 500).recording;
    expect(a.frames).toBe(501);
    expect(hashRecording(a)).toBe(hashRecording(b));
    const n = a.frames * a.robots;
    expect(a.positions.subarray(0, n)).toEqual(b.positions.subarray(0, n));
    expect(hashRecording(c)).not.toBe(hashRecording(a));
  }, 60_000);

  // Feature: sim-core, Property 4: Same inputs, same recording
  // **Validates: Requirements 2.3, 2.6, 5.6**
  // Spec 2 edit (failures-telemetry design D22): faults whose tick is after the
  // run end must not perturb the run, so the hash equals the `faults: []` hash.
  it('Property 4: Same inputs, same recording', () => {
    const caseArb = runCaseArb().chain((c) =>
      fc.tuple(
        fc.constant(c),
        faultArb(loadPreset(c.id), c.robots).map((fs) => fs.map((f) => ({ ...f, tick: f.tick + RUN_TICKS }))),
      ),
    );
    fc.assert(
      fc.property(caseArb, ([c, faults]) => {
        const h1 = hashRecording(runCase(c, RUN_TICKS).recording);
        const h2 = hashRecording(runCase(c, RUN_TICKS).recording);
        const h3 = hashRecording(runCase(c, RUN_TICKS, faults).recording);
        return h1 === h2 && h1 === h3;
      }),
      { numRuns: 25 },
    );
  }, 120_000);

  // Feature: sim-core, Property 5: Different seeds, different recordings
  // **Validates: Requirements 2.4**
  it('Property 5: Different seeds, different recordings', () => {
    fc.assert(
      fc.property(runCaseArb(), seedArb, (c, other) => {
        fc.pre(other !== c.seed);
        const h1 = hashRecording(runCase(c, RUN_TICKS).recording);
        const h2 = hashRecording(runCase({ ...c, seed: other }, RUN_TICKS).recording);
        return h1 !== h2;
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});

describe('mulberry32', () => {
  it('same seed gives the same first value; different seeds differ', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('randInt covers both inclusive bounds', () => {
    const rng = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(randInt(rng, 8, 14));
    expect([...seen].sort((x, y) => x - y)).toEqual([8, 9, 10, 11, 12, 13, 14]);
  });

  // Feature: sim-core, Property 3: PRNG is deterministic and in range
  // **Validates: Requirements 2.2**
  it('Property 3: PRNG is deterministic and in range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (seed, lo, span) => {
          const a = mulberry32(seed);
          const b = mulberry32(seed);
          for (let i = 0; i < 1000; i++) {
            const x = a();
            if (x !== b()) return false;
            if (!(x >= 0 && x < 1)) return false;
          }
          const hi = lo + span;
          const r = mulberry32(seed);
          for (let i = 0; i < 100; i++) {
            const v = randInt(r, lo, hi);
            if (!Number.isInteger(v) || v < lo || v > hi) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
