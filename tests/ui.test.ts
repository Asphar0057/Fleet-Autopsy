import { describe, expect, it } from 'vitest';
import { clampPlayhead, pad4, stepBack, stepForward, tickInterval } from '../src/ui/playback';
import { createSim } from '../src/sim/sim';
import { maxOf, polylinePoints } from '../src/ui/sparkline';
import { loadPreset } from './helpers';

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
