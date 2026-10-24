// Required test 7: headless performance smoke test (Requirement 10.4, 10.5).
// Logs elapsed time; never fails on time. performance.now is allowed in tests only.
import { describe, expect, it } from 'vitest';
import { createSim } from '../src/sim/sim';
import { loadPreset } from './helpers';

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
