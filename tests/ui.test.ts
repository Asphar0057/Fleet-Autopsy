import { describe, expect, it } from 'vitest';
import { clampPlayhead, pad4, stepBack, stepForward, tickInterval } from '../src/ui/playback';
import { createSim } from '../src/sim/sim';
import { maxOf, polylinePoints } from '../src/ui/sparkline';
import { faultLegend, faultTicks, revealMarks } from '../src/ui/legend';
import { SCENARIOS } from '../src/sim/scenarios';
import type { FaultEvent } from '../src/sim/types';
import { loadPreset } from './helpers';

describe('faultLegend (Requirement 8.4)', () => {
  it('describes the decoy-first scenario with tags, ticks, durations, and roles', () => {
    const s = SCENARIOS.find((x) => x.id === 'pd-decoy-first');
    expect(s).toBeDefined();
    if (!s) return;
    expect(faultLegend(s.faults, s.groundTruth, 25)).toBe(
      'ground truth · F1 freeze R6 t=350 30t (decoy) · F2 freeze R3 t=550 permanent (primary)',
    );
  });

  it('uses short words for every fault kind and (x,y) for blocked cells', () => {
    const faults: FaultEvent[] = [
      { kind: 'station-slowdown', tick: 400, station: 1, factor: 4, duration: null },
      { kind: 'blocked-cell', tick: 10, cell: 2 * 39 + 5, duration: 20 },
      { kind: 'slow-robot', tick: 5, robot: 3, period: 2, duration: null },
    ];
    expect(faultLegend(faults, null, 39)).toBe(
      'ground truth · F1 slowdown S02 ×4 t=400 permanent · F2 block (5,2) t=10 20t · F3 slow R3 period 2 t=5 permanent',
    );
    expect(faultLegend([], null, 39)).toBe('ground truth · no faults');
  });
});

describe('revealMarks', () => {
  const faults: FaultEvent[] = [
    { kind: 'robot-freeze', tick: 350, robot: 6, duration: 30 },
    { kind: 'station-slowdown', tick: 100, station: 0, factor: 2, duration: null },
    { kind: 'slow-robot', tick: 360, robot: 6, period: 3, duration: null },
    { kind: 'blocked-cell', tick: 500, cell: 77, duration: null },
  ];

  it('marks only faults that have started, merging tags on a shared target', () => {
    expect(revealMarks(faults, 99)).toEqual([]);
    expect(revealMarks(faults, 360)).toEqual([
      { target: 'robot', index: 6, tag: 'F1 F3' },
      { target: 'station', index: 0, tag: 'F2' },
    ]);
    expect(revealMarks(faults, 500)[2]).toEqual({ target: 'cell', index: 77, tag: 'F4' });
  });

  it('lists fault ticks in fault order', () => {
    expect(faultTicks(faults)).toEqual([350, 100, 360, 500]);
  });
});

describe('playback model (D10)', () => {
  it('steps within the recording, steps the sim only at the end', () => {
    const layout = loadPreset('pocket-dc');
    const sim = createSim(layout, { seed: 7, robots: 4, queueCap: layout.queueCap, faults: [] });
    sim.run(5);
    expect(stepForward(sim, 2)).toBe(3);
    expect(sim.tick).toBe(5);
    expect(stepForward(sim, 5)).toBe(6);
    expect(sim.tick).toBe(6);
    expect(stepBack(3)).toBe(2);
    expect(stepBack(0)).toBe(0);
    expect(clampPlayhead(sim, 99)).toBe(6);
    expect(clampPlayhead(sim, -3)).toBe(0);
  });

  it('runs at 10 ticks per second times the speed', () => {
    expect(tickInterval(1)).toBe(100);
    expect(tickInterval(16)).toBe(6.25);
  });

  it('zero-pads header numbers to 4 digits', () => {
    expect(pad4(42)).toBe('0042');
    expect(pad4(214)).toBe('0214');
    expect(pad4(12345)).toBe('12345');
  });
});

describe('polylinePoints', () => {
  it('maps values into the viewBox, bottom to top', () => {
    expect(polylinePoints([0, 2, 4], 3, 100, 10, 4)).toBe('0,10 50,5 100,0');
  });

  it('downsamples but keeps the last point, and handles empty input', () => {
    const v = Array.from({ length: 10 }, (_, i) => i);
    const pts = polylinePoints(v, 10, 9, 9, 9, 4).split(' ');
    expect(pts.length).toBeLessThanOrEqual(5);
    expect(pts[0]).toBe('0,9');
    expect(pts[pts.length - 1]).toBe('9,0');
    expect(polylinePoints([], 0, 10, 10, 1)).toBe('');
    expect(maxOf([3, 9, 1])).toBe(9);
  });

  it('uses a wider x span for a prefix of a longer series', () => {
    expect(polylinePoints([1, 1], 2, 100, 10, 1, 200, 4)).toBe('0,0 25,0');
  });
});
