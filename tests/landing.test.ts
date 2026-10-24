// Landing jam backdrop: the culprit comes from the scenario's own primary fault,
// the jam forms around the right station by END_TICK, and the ripple timing.
import { describe, expect, it } from 'vitest';
import { stalledAt } from '../src/sim/metrics';
import { positionsAt } from '../src/sim/recorder';
import { SCENARIOS, scenarioConfig } from '../src/sim/scenarios';
import { runHeadless } from '../src/sim/sim';
import {
  BACKDROP_SCENARIO,
  backdropCulprit,
  END_TICK,
  RING_ALPHA,
  RING_GAP_MS,
  RING_MS,
  RING_R0,
  RING_R1,
  ringAt,
  staticRings,
} from '../src/ui/landing/backdropJam';
import { loadPreset } from './helpers';

const scenario = SCENARIOS.find((s) => s.id === BACKDROP_SCENARIO);

describe('backdrop jam', () => {
  it('takes the culprit from the primary fault, not the decoy', () => {
    expect(scenario).toBeDefined();
    if (!scenario) return;
    const primary = scenario.faults[scenario.groundTruth.primaryFaultIndex];
    const c = backdropCulprit(scenario.faults, scenario.groundTruth.primaryFaultIndex);
    expect(primary.kind).toBe('robot-freeze');
    expect(c).toEqual({ robot: primary.kind === 'robot-freeze' ? primary.robot : -1, tick: primary.tick });
    expect(c?.tick).toBeLessThan(END_TICK);
  });

  it('by END_TICK, stalled robots cluster around the frozen robot at the right station', () => {
    if (!scenario) return;
    const layout = loadPreset(scenario.layoutId);
    const config = scenarioConfig(scenario, layout);
    const rec = runHeadless(layout, config, END_TICK);
    const c = backdropCulprit(config.faults, scenario.groundTruth.primaryFaultIndex);
    if (!c) throw new Error('no culprit');
    const pos = positionsAt(rec, END_TICK);
    const cx = pos[c.robot] % layout.width;
    const cy = Math.floor(pos[c.robot] / layout.width);
    expect(cx).toBeGreaterThan(layout.width / 2);
    const stalled = new Uint8Array(rec.robots);
    stalledAt(rec, END_TICK, stalled);
    const near: number[] = [];
    for (let r = 0; r < rec.robots; r++) {
      if (r === c.robot || stalled[r] !== 1) continue;
      const d = Math.abs((pos[r] % layout.width) - cx) + Math.abs(Math.floor(pos[r] / layout.width) - cy);
      if (d <= 8) near.push(r);
    }
    expect(near.length).toBeGreaterThanOrEqual(3);
  });

  it('rings fire 1s apart, expand from R0 to R1 and fade to 0 over each period', () => {
    expect(ringAt(0, 1)).toBeNull();
    expect(ringAt(0, 0)).toEqual({ r: RING_R0, alpha: RING_ALPHA });
    const late = ringAt(RING_MS - 1, 0);
    expect(late?.r).toBeCloseTo(RING_R1, 2);
    expect(late?.alpha).toBeLessThan(0.01);
    expect(ringAt(RING_GAP_MS * 3, 3)).toEqual(ringAt(0, 0));
    // Continuous: the period repeats.
    expect(ringAt(RING_MS + 1234, 0)).toEqual(ringAt(1234, 0));
    const still = staticRings();
    expect(still).toHaveLength(3);
    expect(still[0].alpha).toBeGreaterThan(still[2].alpha);
  });
});
