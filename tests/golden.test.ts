// Golden fault-free hashes recorded from the Spec 1 commit (2a67f47) before any
// Spec 2 sim change. Fault-free runs must stay byte-identical (Requirement 1.9).
import { describe, expect, it } from 'vitest';
import { hashRecording } from '../src/sim/recorder';
import { loadPreset, runCase } from './helpers';

const TICKS = 2000;

const GOLDEN: [id: string, seed: number, hash: string][] = [
  ['pocket-dc', 1, '0ccda51c'],
  ['pocket-dc', 2, '4ad6c12c'],
  ['pocket-dc', 3, '1a0e60be'],
  ['fulfillment-block', 1, '2f1a01e1'],
  ['fulfillment-block', 2, '6d5634d0'],
  ['fulfillment-block', 3, '63a33060'],
  ['chokepoint', 1, '499fe66a'],
  ['chokepoint', 2, 'a39def24'],
  ['chokepoint', 3, 'b805d38f'],
];

describe('golden Spec 1 hashes (Requirement 1.9)', () => {
  it.each(GOLDEN)('%s seed %i at recommended robots, 2,000 ticks', (id, seed, hash) => {
    const robots = loadPreset(id).recommendedRobots;
    const rec = runCase({ id, seed, robots }, TICKS).recording;
    expect(rec.frames).toBe(TICKS + 1);
    expect(hashRecording(rec)).toBe(hash);
  }, 60_000);
});
