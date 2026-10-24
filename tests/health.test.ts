import { describe, expect, it } from 'vitest';
import { createSim } from '../src/sim/sim';
import { verifyRun } from '../src/sim/verify';
import { createWaitCounter } from '../src/sim/metrics';
import type { Recording } from '../src/sim/recorder';
import type { Layout } from '../src/sim/layout';
import { CellKind, EKind, RState } from '../src/sim/types';
import type { Violation } from '../src/sim/types';
import fc from 'fast-check';
import { loadPreset, runCase, runCaseArb } from './helpers';

const TICKS = 2000;
const CASES: [string, number][] = [];
for (const id of ['pocket-dc', 'fulfillment-block', 'chokepoint']) for (const seed of [1, 2, 3]) CASES.push([id, seed]);

describe('health (required test 5)', () => {
  it.each(CASES)(
    '%s seed %i: verifier-clean, every robot delivers, no stalls over 2000 ticks',
    (id, seed) => {
      const layout = loadPreset(id);
      const robots = layout.recommendedRobots;
      const sim = createSim(layout, { seed, robots, queueCap: layout.queueCap, faults: [] });
      sim.run(TICKS);
      const rec = sim.recording;

      const deliveries = new Int32Array(robots);
      const stalls: string[] = [];
      let lastWindow = 0;
      for (let e = 0; e < rec.events; e++) {
        if (rec.evKind[e] === EKind.Deliver) {
          deliveries[rec.evRobot[e]]++;
          if (rec.evTick[e] > TICKS - 100) lastWindow++;
        }
        if (rec.evKind[e] === EKind.Stall) stalls.push(`R${rec.evRobot[e]}@${rec.evTick[e]}`);
      }
      // Longest standstill per robot outside serving and idle (the prototype's maxIdle).
      const maxIdle = new Int32Array(robots);
      const since = new Int32Array(robots);
      for (let t = 1; t < rec.frames; t++) {
        for (let r = 0; r < robots; r++) {
          const st = rec.states[t * robots + r];
          if (rec.positions[t * robots + r] !== rec.positions[(t - 1) * robots + r]) since[r] = t;
          if (st === RState.Serving || st === RState.Idle) continue;
          maxIdle[r] = Math.max(maxIdle[r], t - since[r]);
        }
      }
      const total = deliveries.reduce((a, b) => a + b, 0);
      console.log(
        `${id} seed ${seed}: ${((total * 100) / TICKS).toFixed(1)} deliveries/100 ticks ` +
          `(trailing 100: ${lastWindow}), per robot deliveries min ${Math.min(...deliveries)} ` +
          `max ${Math.max(...deliveries)}, max idle per robot min ${Math.min(...maxIdle)} max ${Math.max(...maxIdle)}`,
      );

      expect(rec.frames).toBe(TICKS + 1);
      expect(verifyRun(rec, layout)).toEqual([]);
      expect(stalls).toEqual([]);
      expect(Math.min(...deliveries)).toBeGreaterThanOrEqual(1);
    },
    120_000,
  );
});

// Run-level properties: each case runs a full simulation (design.md Correctness Properties).
const RUN_TICKS = 300;
const NUM_RUNS = 25;
const PROP_TIMEOUT = 120_000;

/** Mutable copy of a recording, trimmed to its used length. */
function copyRecording(rec: Recording): Recording {
  const n = rec.frames * rec.robots;
  return {
    robots: rec.robots,
    stations: rec.stations,
    frames: rec.frames,
    positions: rec.positions.slice(0, n),
    goals: rec.goals.slice(0, n),
    states: rec.states.slice(0, n),
    queueLen: rec.queueLen.slice(0, rec.frames * rec.stations),
    evTick: rec.evTick.slice(0, rec.events),
    evRobot: rec.evRobot.slice(0, rec.events),
    evKind: rec.evKind.slice(0, rec.events),
    evArg: rec.evArg.slice(0, rec.events),
    events: rec.events,
  };
}

function manhattan(layout: Layout, a: number, b: number): number {
  const w = layout.width;
  return Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
}

describe('run-level properties', () => {
  // Feature: sim-core, Property 8: Runs are verifier-clean
  // **Validates: Requirements 2.1, 3.4, 3.5, 4.8, 10.1**
  it(
    'Property 8: Runs are verifier-clean',
    () => {
      fc.assert(
        fc.property(runCaseArb(), (c) => {
          const layout = loadPreset(c.id);
          const rec = runCase(c, RUN_TICKS).recording;
          expect(verifyRun(rec, layout)).toEqual([]);
          const n = rec.frames * rec.robots;
          for (let i = 0; i < n; i++) {
            if (layout.kinds[rec.positions[i]] === CellKind.Charger) {
              throw new Error(`robot ${i % rec.robots} on charger at frame ${Math.floor(i / rec.robots)}`);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROP_TIMEOUT,
  );

  // Feature: sim-core, Property 9: Station exclusivity and queue cap
  // **Validates: Requirements 4.1, 4.2, 4.6, 4.7**
  it(
    'Property 9: Station exclusivity and queue cap',
    () => {
      fc.assert(
        fc.property(runCaseArb(), (c) => {
          const layout = loadPreset(c.id);
          const rec = runCase(c, RUN_TICKS).recording;
          const S = layout.stations.length;
          const onStation = new Int32Array(S);
          for (let t = 0; t < rec.frames; t++) {
            onStation.fill(0);
            for (let r = 0; r < rec.robots; r++) {
              const cell = rec.positions[t * rec.robots + r];
              const s = layout.stationAt[cell] >= 0 ? layout.stationAt[cell] : layout.accessOf[cell];
              if (s >= 0) onStation[s]++;
            }
            for (let s = 0; s < S; s++) {
              if (onStation[s] > 1) throw new Error(`station ${s}: ${onStation[s]} robots at frame ${t}`);
              const q = rec.queueLen[t * S + s];
              if (q > layout.queueCap) throw new Error(`station ${s}: queue ${q} > cap at frame ${t}`);
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROP_TIMEOUT,
  );

  // Feature: sim-core, Property 10: Task cycle and pod exclusivity
  // **Validates: Requirements 4.3, 4.4**
  it(
    'Property 10: Task cycle and pod exclusivity',
    () => {
      const CYCLE = [EKind.Pick, EKind.ServiceStart, EKind.ServiceEnd, EKind.Deliver] as const;
      fc.assert(
        fc.property(runCaseArb(), (c) => {
          const layout = loadPreset(c.id);
          const rec = runCase(c, RUN_TICKS).recording;
          const next = new Int32Array(rec.robots); // index into CYCLE of the expected next event
          const pickedPod = new Int32Array(rec.robots).fill(-1);
          const startTick = new Int32Array(rec.robots);
          const carrier = new Int32Array(layout.kinds.length).fill(-1);
          for (let e = 0; e < rec.events; e++) {
            const k = rec.evKind[e];
            if (k === EKind.Stall) continue;
            const r = rec.evRobot[e];
            const t = rec.evTick[e];
            const where = `robot ${r} event ${e} (kind ${k}) at tick ${t}`;
            if (k !== CYCLE[next[r]]) throw new Error(`${where}: expected kind ${CYCLE[next[r]]}`);
            next[r] = (next[r] + 1) % CYCLE.length;
            if (k === EKind.Pick) {
              const p = rec.evArg[e];
              if (carrier[p] >= 0) throw new Error(`${where}: pod ${p} already carried by ${carrier[p]}`);
              carrier[p] = r;
              pickedPod[r] = p;
            } else if (k === EKind.ServiceStart) {
              startTick[r] = t;
            } else if (k === EKind.ServiceEnd) {
              const d = t - startTick[r];
              if (d < 8 || d > 14) throw new Error(`${where}: service lasted ${d} ticks`);
            } else if (k === EKind.Deliver) {
              const p = rec.evArg[e];
              if (p !== pickedPod[r]) throw new Error(`${where}: delivered pod ${p}, picked ${pickedPod[r]}`);
              carrier[p] = -1;
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROP_TIMEOUT,
  );

  // Feature: sim-core, Property 12: Verifier detects injected faults
  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
  it(
    'Property 12: Verifier detects injected faults',
    () => {
      const kindArb = fc.constantFrom<Violation['kind']>('same-cell', 'swap', 'jump', 'illegal-cell');
      fc.assert(
        fc.property(
          runCaseArb(2),
          kindArb,
          fc.integer({ min: 1, max: RUN_TICKS }),
          fc.nat(),
          fc.nat(),
          fc.nat(),
          (c, kind, t, ra, rb, pick) => {
            const layout = loadPreset(c.id);
            const clean = runCase(c, RUN_TICKS).recording;
            expect(verifyRun(clean, layout)).toEqual([]);
            const rec = copyRecording(clean);
            const n = rec.robots;
            const P = rec.positions;
            const a = ra % n;
            let b = (a + 1 + (rb % (n - 1))) % n; // distinct from a
            let expected: number[];

            if (kind === 'same-cell') {
              P[t * n + b] = P[t * n + a];
              expected = [a, b];
            } else if (kind === 'swap') {
              // a and b exchange x and y between t-1 and t, with y a non-wall neighbor of x.
              // If a robot already stands on y at t-1 it becomes b, so y has a single owner.
              const x = P[(t - 1) * n + a];
              const ys: number[] = [];
              for (let d = 0; d < 4; d++) {
                const y = layout.neighbors[x * 4 + d];
                if (y >= 0 && layout.kinds[y] !== CellKind.Wall) ys.push(y);
              }
              const y = ys[pick % ys.length];
              for (let r = 0; r < n; r++) if (r !== a && P[(t - 1) * n + r] === y) b = r;
              P[(t - 1) * n + b] = y;
              P[t * n + a] = y;
              P[t * n + b] = x;
              expected = [Math.min(a, b), Math.max(a, b)];
            } else if (kind === 'jump') {
              const prev = P[(t - 1) * n + a];
              const far: number[] = [];
              for (let k = 0; k < layout.floor.length; k++) {
                if (manhattan(layout, prev, layout.floor[k]) >= 2) far.push(layout.floor[k]);
              }
              P[t * n + a] = far[pick % far.length];
              expected = [a];
            } else {
              const walls: number[] = [];
              for (let cell = 0; cell < layout.kinds.length; cell++) {
                if (layout.kinds[cell] === CellKind.Wall) walls.push(cell);
              }
              P[t * n + a] = walls[pick % walls.length];
              expected = [a];
            }

            const found = verifyRun(rec, layout).some(
              (v) => v.kind === kind && v.tick === t && expected.every((r) => v.robots.includes(r)),
            );
            if (!found) throw new Error(`no ${kind} violation at tick ${t} naming ${expected.join(',')}`);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    PROP_TIMEOUT,
  );

  // Feature: sim-core, Property 14: Incremental wait counts match a recount
  // **Validates: Requirements 7.4**
  it(
    'Property 14: Incremental wait counts match a recount',
    () => {
      fc.assert(
        fc.property(
          runCaseArb(),
          fc.array(fc.integer({ min: 0, max: RUN_TICKS }), { minLength: 1, maxLength: 12 }),
          (c, queries) => {
            const layout = loadPreset(c.id);
            const rec = runCase(c, RUN_TICKS).recording;
            const counter = createWaitCounter(layout);
            const n = rec.robots;
            for (const q of queries) {
              const naive = new Uint16Array(layout.kinds.length);
              for (let t = 1; t <= q; t++) {
                for (let r = 0; r < n; r++) {
                  const cell = rec.positions[t * n + r];
                  if (cell !== rec.positions[(t - 1) * n + r]) continue;
                  const st = rec.states[t * n + r];
                  if (st === RState.Serving || st === RState.Idle) continue;
                  naive[cell]++;
                }
              }
              expect(counter.at(rec, q)).toEqual(naive);
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    PROP_TIMEOUT,
  );
});
