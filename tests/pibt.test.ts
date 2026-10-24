import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDistanceCache, INF } from '../src/sim/distance';
import { CellKind } from '../src/sim/types';
import { loadPreset, PRESET_IDS } from './helpers';

describe('distance cache', () => {
  it('returns the same Int16Array instance for a repeated get', () => {
    const l = loadPreset('pocket-dc');
    const cache = createDistanceCache(l);
    const a = cache.get(l.stations[0], l.access[0]);
    expect(a).toBeInstanceOf(Int16Array);
    expect(cache.get(l.stations[0], l.access[0])).toBe(a);
    // A different allowAccess is a different map.
    expect(cache.get(l.stations[0], -1)).not.toBe(a);
  });

  it('reaches a station only through its own access cell', () => {
    const l = loadPreset('pocket-dc');
    const cache = createDistanceCache(l);
    const open = cache.get(l.stations[0], l.access[0]);
    const blocked = cache.get(l.stations[0], -1);
    expect(open[l.access[0]]).toBe(1);
    expect(open[l.floor.find((c) => l.accessOf[c] < 0)!]).toBeLessThan(INF);
    // With the only entry blocked, no floor cell can reach the station.
    for (const c of l.floor) expect(blocked[c]).toBe(INF);
  });
});

describe('properties', () => {
  // Feature: sim-core, Property 6: Distance maps respect blocked access cells
  // **Validates: Requirements 3.6**
  it('Property 6: Distance maps respect blocked access cells', () => {
    const input = fc.constantFrom(...PRESET_IDS).chain((id) => {
      const l = loadPreset(id);
      const goals = l.kinds.reduce<number[]>((acc, k, i) => (k !== CellKind.Wall ? (acc.push(i), acc) : acc), []);
      return fc.record({
        id: fc.constant(id),
        goal: fc.constantFrom(...goals),
        allow: fc.constantFrom(-1, ...l.access),
      });
    });
    fc.assert(
      fc.property(input, ({ id, goal, allow }) => {
        const l = loadPreset(id);
        const map = createDistanceCache(l).get(goal, allow);
        expect(map[goal]).toBe(0);
        for (let c = 0; c < l.kinds.length; c++) {
          if (c === goal) continue;
          const k = l.kinds[c];
          if (k !== CellKind.Floor) {
            expect(map[c]).toBe(INF); // walls and non-goal endpoints
            continue;
          }
          if (l.accessOf[c] >= 0 && c !== allow) {
            expect(map[c]).toBe(INF);
            continue;
          }
          if (map[c] === INF) continue;
          let hasPred = false;
          for (let d = 0; d < 4; d++) {
            const n = l.neighbors[c * 4 + d];
            if (n >= 0 && map[n] === map[c] - 1) hasPred = true;
          }
          expect(hasPred).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
