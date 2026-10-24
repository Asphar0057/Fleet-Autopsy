// Required test 7: headless performance smoke test (Requirement 10.4, 10.5).
// Logs elapsed time; never fails on time. performance.now is allowed in tests only.
import { describe, expect, it } from 'vitest';
import { createSim, runHeadless } from '../src/sim/sim';
import type { FaultEvent } from '../src/sim/types';
import { verifyRun } from '../src/sim/verify';
import { blockableFor, loadPreset } from './helpers';

const PRESET = 'fulfillment-block';
const SEED = 1;

function timeRun(robots: number, ticks: number): { constructMs: number; runMs: number; frames: number } {
  const layout = loadPreset(PRESET);
  const t0 = performance.now();
  const sim = createSim(layout, { seed: SEED, robots, queueCap: layout.queueCap, faults: [] });
  const t1 = performance.now();
  sim.run(ticks);
  const t2 = performance.now();
  return { constructMs: t1 - t0, runMs: t2 - t1, frames: sim.recording.frames };
}

describe('perf (required test 7)', () => {
  it('warm-up run (100 ticks, 36 robots, not timed)', () => {
    expect(timeRun(36, 100).frames).toBe(101);
  });

  it.each([
    [36, 1000],
    [45, 1000],
    [36, 2000],
  ])(
    `${PRESET} seed ${SEED}: %i robots, %i ticks`,
    (robots, ticks) => {
      const r = timeRun(robots, ticks);
      console.log(
        `perf ${PRESET} seed ${SEED} ${robots} robots ${ticks} ticks: ` +
          `run ${r.runMs.toFixed(0)} ms, construction ${r.constructMs.toFixed(1)} ms ` +
          `(timed separately; target ~1500 ms run for 1000 ticks)`,
      );
      expect(r.frames).toBe(ticks + 1);
    },
    120_000,
  );
});

describe('perf: faulted headless run (Requirement 7.3)', () => {
  it(
    `${PRESET} seed ${SEED}: 36 robots, 2000 ticks, freeze + slowdown + blocked cell via runHeadless`,
    () => {
      const layout = loadPreset(PRESET);
      const cells = blockableFor(layout);
      const faults: FaultEvent[] = [
        { kind: 'robot-freeze', tick: 500, robot: 3, duration: null },
        { kind: 'station-slowdown', tick: 400, station: 0, factor: 3, duration: null },
        { kind: 'blocked-cell', tick: 300, cell: cells[cells.length >> 1], duration: 800 },
      ];
      const config = { seed: SEED, robots: 36, queueCap: layout.queueCap, faults };
      const t0 = performance.now();
      const rec = runHeadless(layout, config, 2000);
      const ms = performance.now() - t0;
      console.log(
        `perf ${PRESET} seed ${SEED} 36 robots 2000 ticks faulted (runHeadless): ` +
          `${ms.toFixed(0)} ms (target ~500 ms; not asserted)`,
      );
      expect(rec.frames).toBe(2001);
      expect(verifyRun(rec, layout, faults)).toEqual([]);
    },
    120_000,
  );
});
