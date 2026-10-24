import { describe, expect, it } from 'vitest';
import { createSim } from '../src/sim/sim';
import { verifyRun } from '../src/sim/verify';
import { EKind, RState } from '../src/sim/types';
import { loadPreset } from './helpers';

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
