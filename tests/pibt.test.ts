import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDistanceCache, INF } from '../src/sim/distance';
import type { DistanceCache } from '../src/sim/distance';
import { parseLayout } from '../src/sim/layout';
import type { Layout } from '../src/sim/layout';
import { createPlanner } from '../src/sim/pibt';
import type { PlanInput } from '../src/sim/pibt';
import { effectivePriority, createSim, pickHolder, stallDue } from '../src/sim/sim';
import { verifyRun } from '../src/sim/verify';
import { CellKind, EKind, RState } from '../src/sim/types';
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

describe('sim station rules', () => {
  // One station in a one-cell notch: station (4,1), access (4,2), corridor row 3, pods on row 4.
  const grid = ['#########', '####S####', '####.####', '#.......#', '#p.p.p.p#', '#########'].join('\n') + '\n';
  const l = parseLayout(metaFor(grid, 'notch'), grid);
  const station = l.stations[0];
  const acc = l.access[0];

  // Required test 6. Three robots share one station: each hand-off has a departing
  // holder leaving the notch while the next robot waits at the access cell's mouth.
  it.each([1, 2, 3, 4, 5])('hands off the station without deadlock within 100 ticks (seed %i)', (seed) => {
    const sim = createSim(l, { seed, robots: 3, queueCap: 3, faults: [] });
    sim.run(100);
    const rec = sim.recording;
    expect(verifyRun(rec, l)).toEqual([]);
    // At most one robot on the station cell plus its access cell, every frame.
    for (let t = 0; t < rec.frames; t++) {
      let onStation = 0;
      for (let r = 0; r < 3; r++) {
        const c = rec.positions[t * 3 + r];
        if (c === station || c === acc) onStation++;
      }
      expect(onStation).toBeLessThanOrEqual(1);
    }
    const starts: { tick: number; robot: number }[] = [];
    const ends: { tick: number; robot: number }[] = [];
    for (let e = 0; e < rec.events; e++) {
      expect(rec.evKind[e]).not.toBe(EKind.Stall);
      const ev = { tick: rec.evTick[e], robot: rec.evRobot[e] };
      if (rec.evKind[e] === EKind.ServiceStart) starts.push(ev);
      if (rec.evKind[e] === EKind.ServiceEnd) ends.push(ev);
    }
    // The reservation passed between different robots several times.
    expect(new Set(starts.map((s) => s.robot)).size).toBeGreaterThanOrEqual(2);
    expect(starts.length).toBeGreaterThanOrEqual(4);
    // Each service-end is followed by the next service-start promptly: the departing
    // robot clears the notch and the waiting robot enters, with no deadlock.
    for (let k = 0; k + 1 < starts.length; k++) {
      expect(ends[k].robot).toBe(starts[k].robot);
      expect(starts[k + 1].tick - ends[k].tick).toBeLessThanOrEqual(15);
    }
  });

  it('pickHolder picks the queued robot nearest the access cell, ties by lower id', () => {
    const d = createDistanceCache(l).get(acc, acc);
    const at = (x: number, y: number) => y * l.width + x;
    // Robots 0 and 2 are both 2 steps from the access cell; robot 1 is 4 steps away.
    const pos = Int16Array.of(at(3, 3), at(1, 3), at(5, 3));
    expect(d[pos[0]]).toBe(2);
    expect(d[pos[2]]).toBe(2);
    expect(pickHolder(Int16Array.of(2, 1, 0), 3, pos, d)).toBe(0);
    expect(pickHolder(Int16Array.of(2, 1), 2, pos, d)).toBe(2);
    expect(pickHolder(Int16Array.of(9, 1, 2), 2, pos, d, 1)).toBe(2); // offset into a shared buffer
    expect(pickHolder(Int16Array.of(), 0, pos, d)).toBe(-1);
  });

  it('createSim rejects bad configs', () => {
    const ok = { seed: 1, robots: 3, queueCap: 3, faults: [] };
    expect(() => createSim(l, ok)).not.toThrow();
    expect(() => createSim(l, { ...ok, robots: 0 })).toThrow(/robots/);
    expect(() => createSim(l, { ...ok, robots: 4 })).toThrow(/pods/); // robots >= pods
    expect(() => createSim(l, { ...ok, queueCap: 0 })).toThrow(/queueCap/);
    const tiny = ['#####', '#S.p#', '##.p#', '##.p#', '##p##', '#####'].join('\n') + '\n';
    const t = parseLayout(metaFor(tiny, 'tiny'), tiny);
    // 3 floor cells, 1 station, 4 pods: 3 robots are fewer than pods but exceed floor - stations.
    expect(() => createSim(t, { ...ok, robots: 2 })).not.toThrow();
    expect(() => createSim(t, { ...ok, robots: 3 })).toThrow(/floor/);
  });
});

describe('effective priority and stalls', () => {
  it('puts idle robots lowest, queued non-holders next, others by age', () => {
    expect(effectivePriority(RState.Idle, false, 50)).toBe(-2);
    expect(effectivePriority(RState.ToStation, false, 50)).toBe(-1);
    expect(effectivePriority(RState.ToStation, true, 5)).toBe(5);
    expect(effectivePriority(RState.ToPod, false, 7)).toBe(7);
    expect(effectivePriority(RState.Returning, true, 0)).toBe(0);
    expect(effectivePriority(RState.Returning, false, 3)).toBe(3);
  });

  it('stallDue fires once at 200 ticks, never for serving or idle robots', () => {
    for (const st of [RState.ToPod, RState.ToStation, RState.Returning]) {
      expect(stallDue(199, 0, st, 0)).toBe(false);
      expect(stallDue(200, 0, st, 0)).toBe(true);
      expect(stallDue(260, 60, st, 0)).toBe(true);
      expect(stallDue(201, 0, st, 1)).toBe(false); // already fired for this standstill
    }
    expect(stallDue(500, 0, RState.Serving, 0)).toBe(false);
    expect(stallDue(500, 0, RState.Idle, 0)).toBe(false);
  });

  it('stallDue fires once over a long standstill', () => {
    let fired = 0;
    let count = 0;
    for (let t = 1; t <= 600; t++) {
      if (stallDue(t, 0, RState.ToPod, fired)) {
        fired = 1;
        count++;
      }
    }
    expect(count).toBe(1);
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
