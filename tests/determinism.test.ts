import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mulberry32, randInt } from '../src/sim/rng';

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
