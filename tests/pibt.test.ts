import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDistanceCache, INF } from '../src/sim/distance';
import type { DistanceCache } from '../src/sim/distance';
import { parseLayout } from '../src/sim/layout';
import type { Layout } from '../src/sim/layout';
import { createPlanner } from '../src/sim/pibt';
import type { PlanInput } from '../src/sim/pibt';
import { CellKind } from '../src/sim/types';
import { loadPreset, metaFor, PRESET_IDS } from './helpers';

function makeInput(n: number): PlanInput {
  return {
    n,
    pos: new Int16Array(n),
    goal: new Int16Array(n),
    prio: new Int32Array(n),
    pinned: new Uint8Array(n),
    allowAccess: new Int16Array(n).fill(-1),
    holds: new Int16Array(n).fill(-1),
    tieRot: new Uint8Array(n),
  };
}

function isNeighbor(l: Layout, a: number, b: number): boolean {
  for (let d = 0; d < 4; d++) if (l.neighbors[a * 4 + d] === b) return true;
  return false;
}

/** Returns the first safety problem in a planned step, or null. */
function safetyProblem(l: Layout, inp: PlanInput, out: Int16Array): string | null {
  const { n, pos, goal, pinned, holds } = inp;
  for (let i = 0; i < n; i++) {
    const c = out[i];
    if (c !== pos[i] && !isNeighbor(l, pos[i], c)) return `r${i} jumps ${pos[i]} -> ${c}`;
    if (pinned[i] === 1 && c !== pos[i]) return `pinned r${i} moved`;
    if (c !== pos[i]) {
      const k = l.kinds[c];
      if (k === CellKind.Wall) return `r${i} enters wall ${c}`;
      if (k !== CellKind.Floor && c !== goal[i]) return `r${i} enters non-goal endpoint ${c}`;
      if (l.accessOf[c] >= 0 && (holds[i] < 0 || l.access[holds[i]] !== c)) {
        return `r${i} enters access cell ${c} it does not hold`;
      }
    }
    for (let j = i + 1; j < n; j++) {
      if (out[j] === c) return `r${i} and r${j} share ${c}`;
      if (c === pos[j] && out[j] === pos[i]) return `r${i} and r${j} swap`;
    }
  }
  return null;
}

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

describe('pibt planner', () => {
  // Required test 4. One-cell aisle x = 1..7 on row 1, side pocket at (6, 2).
  const grid = ['#########', '#.......#', '######.##', '#########'].join('\n') + '\n';
  const l = parseLayout(metaFor(grid, 'aisle'), grid);
  const at = (x: number, y: number) => y * l.width + x;

  // Every tieRot for robot A (west start) x every tieRot for robot B (east start),
  // under both id orderings: 50 cases. The outcome must not depend on tie order or ids.
  const headOnCases: [number, number, boolean][] = [];
  for (const aFirst of [true, false])
    for (let rotA = 0; rotA < 5; rotA++) for (let rotB = 0; rotB < 5; rotB++) headOnCases.push([rotA, rotB, aFirst]);

  it.each(headOnCases)(
    'resolves a head-on meeting in a one-cell aisle with a side pocket (tieRot A=%i B=%i, A is id 0: %s)',
    (rotA, rotB, aFirst) => {
      const planner = createPlanner(l, createDistanceCache(l), 2);
      const inp = makeInput(2);
      const a = aFirst ? 0 : 1;
      const b = 1 - a;
      inp.pos[a] = at(1, 1);
      inp.goal[a] = at(7, 1);
      inp.tieRot[a] = rotA;
      inp.pos[b] = at(7, 1);
      inp.goal[b] = at(1, 1);
      inp.tieRot[b] = rotB;
      const out = new Int16Array(2);
      let steps = 0;
      while ((inp.pos[0] !== inp.goal[0] || inp.pos[1] !== inp.goal[1]) && steps < 50) {
        planner.plan(inp, out);
        expect(safetyProblem(l, inp, out)).toBeNull();
        inp.pos.set(out);
        // As the sim will: age +1 while away from the goal, reset to 0 at the goal.
        for (let i = 0; i < 2; i++) inp.prio[i] = inp.pos[i] === inp.goal[i] ? 0 : inp.prio[i] + 1;
        steps++;
      }
      expect([...inp.pos]).toEqual([...inp.goal]);
      expect(steps).toBeLessThanOrEqual(20);
    },
  );

  it('never moves a pinned robot and routes others around it', () => {
    const planner = createPlanner(l, createDistanceCache(l), 2);
    const inp = makeInput(2);
    inp.pos.set([at(3, 1), at(4, 1)]);
    inp.goal.set([at(7, 1), at(1, 1)]);
    inp.pinned[1] = 1;
    inp.prio.set([100, 0]);
    const out = new Int16Array(2);
    planner.plan(inp, out);
    expect([...out]).toEqual([at(3, 1), at(4, 1)]);
  });

  it('orders by priority, then lower id', () => {
    // Two robots want the same free cell (4,1); the winner is the one planned first.
    const planner = createPlanner(l, createDistanceCache(l), 2);
    const inp = makeInput(2);
    inp.pos.set([at(3, 1), at(5, 1)]);
    inp.goal.set([at(7, 1), at(1, 1)]);
    const out = new Int16Array(2);
    planner.plan(inp, out);
    expect(out[0]).toBe(at(4, 1)); // tie: lower id first
    inp.prio.set([0, 1]);
    planner.plan(inp, out);
    expect(out[1]).toBe(at(4, 1)); // higher priority first
  });
});

const caches = new Map<string, DistanceCache>();
function cacheFor(id: string): DistanceCache {
  let c = caches.get(id);
  if (!c) {
    c = createDistanceCache(loadPreset(id));
    caches.set(id, c);
  }
  return c;
}

describe('planner properties', () => {
  // Feature: sim-core, Property 7: Planner output is safe
  // **Validates: Requirements 3.3, 3.4, 3.5, 3.9**
  // Robots are placed anywhere on floor cells (access cells included, so a
  // non-holder may start on one and must only stay or leave). Goals are any non-wall cell.
  it('Property 7: Planner output is safe', () => {
    const input = fc.constantFrom(...PRESET_IDS).chain((id) => {
      const l = loadPreset(id);
      const floor = [...l.floor];
      const goals = l.kinds.reduce<number[]>((acc, k, i) => (k !== CellKind.Wall ? (acc.push(i), acc) : acc), []);
      return fc.shuffledSubarray(floor, { minLength: 1, maxLength: l.maxRobots }).chain((pos) => {
        const n = pos.length;
        const arr = <T>(a: fc.Arbitrary<T>) => fc.array(a, { minLength: n, maxLength: n });
        return fc.record({
          id: fc.constant(id),
          pos: fc.constant(pos),
          goal: arr(fc.constantFrom(...goals)),
          prio: arr(fc.integer({ min: -2, max: 40 })),
          pinned: arr(fc.boolean()),
          tieRot: arr(fc.integer({ min: 0, max: 4 })),
          holderOf: fc.array(fc.integer({ min: -1, max: n - 1 }), {
            minLength: l.stations.length,
            maxLength: l.stations.length,
          }),
        });
      });
    });
    fc.assert(
      fc.property(input, (g) => {
        const l = loadPreset(g.id);
        const n = g.pos.length;
        const inp = makeInput(n);
        inp.pos.set(g.pos);
        inp.goal.set(g.goal);
        inp.prio.set(g.prio);
        inp.pinned.set(g.pinned.map(Number));
        inp.tieRot.set(g.tieRot);
        // At most one holder per station, at most one station per robot.
        g.holderOf.forEach((r, s) => {
          if (r >= 0 && inp.holds[r] < 0) inp.holds[r] = s;
        });
        // allowAccess as the sim sets it: the held station's access cell, else the
        // goal station's access cell, else none.
        for (let i = 0; i < n; i++) {
          const target = inp.holds[i] >= 0 ? inp.holds[i] : l.stationAt[inp.goal[i]];
          inp.allowAccess[i] = target >= 0 ? l.access[target] : -1;
        }
        const out = new Int16Array(n).fill(-1);
        createPlanner(l, cacheFor(g.id), n).plan(inp, out);
        expect(safetyProblem(l, inp, out)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
