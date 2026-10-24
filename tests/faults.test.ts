import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { blockableCells, isActive, validateFaults } from '../src/sim/faults';
import type { Layout } from '../src/sim/layout';
import { createSim } from '../src/sim/sim';
import type { FaultEvent } from '../src/sim/types';
import { loadPreset, PRESET_IDS } from './helpers';

const PRESETS = ['pocket-dc', 'fulfillment-block', 'chokepoint'];

function block(cell: number, tick = 1, duration: number | null = null): FaultEvent {
  return { kind: 'blocked-cell', tick, cell, duration };
}

function create(layout: Layout, faults: FaultEvent[]) {
  return createSim(layout, { seed: 1, robots: 1, queueCap: layout.queueCap, faults });
}

/**
 * Naive D8 reference, written from the glyph rules without faults.ts helpers:
 * grid coordinates, a Set-based flood fill, and string kinds.
 */
function referenceInvalid(layout: Layout, cells: number[]): boolean {
  const { width, height } = layout;
  const name = (c: number) => ['wall', 'floor', 'pod', 'station', 'charger'][layout.kinds[c]];
  const accessCells = new Set(Array.from(layout.access));
  for (const c of cells) {
    if (name(c) !== 'floor') return true;
    if (accessCells.has(c)) return true;
  }
  const blocked = new Set(cells);
  const open = (c: number) => name(c) === 'floor' && !blocked.has(c);
  const around = (c: number) => {
    const x = c % width;
    const y = Math.floor(c / width);
    const out: number[] = [];
    if (x > 0) out.push(c - 1);
    if (x < width - 1) out.push(c + 1);
    if (y > 0) out.push(c - width);
    if (y < height - 1) out.push(c + width);
    return out;
  };
  const all = [...Array(width * height).keys()];
  const openCells = all.filter(open);
  if (openCells.length === 0) return true;
  const seen = new Set<number>([openCells[0]]);
  const stack = [openCells[0]];
  while (stack.length > 0) {
    const c = stack.pop() as number;
    for (const nb of around(c)) {
      if (open(nb) && !seen.has(nb)) {
        seen.add(nb);
        stack.push(nb);
      }
    }
  }
  if (seen.size !== openCells.length) return true;
  for (const c of all) {
    const k = name(c);
    if (k === 'pod' || k === 'station' || k === 'charger') {
      if (!around(c).some(open)) return true;
    }
  }
  return false;
}

describe('isActive', () => {
  it('covers tick <= t < tick + duration, unbounded when permanent', () => {
    const f: FaultEvent = { kind: 'robot-freeze', tick: 10, robot: 0, duration: 5 };
    expect([9, 10, 14, 15].map((t) => isActive(f, t))).toEqual([false, true, true, false]);
    const p: FaultEvent = { ...f, duration: null };
    expect([9, 10, 1e6].map((t) => isActive(p, t))).toEqual([false, true, true]);
  });
});

describe('validateFaults', () => {
  const l = loadPreset('pocket-dc');
  const bad: [string, FaultEvent, RegExp][] = [
    ['tick 0', { kind: 'robot-freeze', tick: 0, robot: 0, duration: null }, /fault 0 .*tick/],
    ['fractional tick', { kind: 'robot-freeze', tick: 1.5, robot: 0, duration: null }, /tick/],
    ['robot out of range', { kind: 'robot-freeze', tick: 1, robot: 1, duration: null }, /robot/],
    ['duration 0', { kind: 'slow-robot', tick: 1, robot: 0, period: 2, duration: 0 }, /duration/],
    ['period 5', { kind: 'slow-robot', tick: 1, robot: 0, period: 5, duration: null }, /period/],
    ['station out of range', { kind: 'station-slowdown', tick: 1, station: 99, factor: 2, duration: 3 }, /station/],
    ['factor 1', { kind: 'station-slowdown', tick: 1, station: 0, factor: 1, duration: 3 }, /factor/],
    ['cell out of range', block(-1), /cell/],
    ['access cell', block(l.access[0]), /access cell of station 0/],
    ['wall cell', block(0), /not plain floor/],
  ];
  it.each(bad)('rejects %s with a descriptive error', (_name, f, re) => {
    expect(() => validateFaults(l, 1, [f])).toThrow(re);
    expect(() => create(l, [f])).toThrow(re);
  });

  it('rejects an unknown kind and names the fault index', () => {
    const f = JSON.parse('{"kind":"stop","tick":1,"duration":null}') as FaultEvent;
    const ok: FaultEvent = { kind: 'robot-freeze', tick: 1, robot: 0, duration: null };
    expect(() => validateFaults(l, 1, [ok, f])).toThrow(/fault 1 .*unknown fault kind 'stop'/);
  });

  it('accepts an empty list and valid faults of every kind', () => {
    const cell = blockableCells(l)[0];
    const faults: FaultEvent[] = [
      { kind: 'robot-freeze', tick: 1, robot: 0, duration: null },
      { kind: 'slow-robot', tick: 5, robot: 0, period: 4, duration: 10 },
      { kind: 'station-slowdown', tick: 2, station: 0, factor: 3, duration: null },
      block(cell, 3, 20),
    ];
    expect(() => validateFaults(l, 1, [])).not.toThrow();
    expect(() => create(l, faults)).not.toThrow();
  });

  it.each(PRESET_IDS)('blockableCells on %s are plain floor, not access, and each passes alone', (id) => {
    const layout = loadPreset(id);
    const cells = Array.from(blockableCells(layout));
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(referenceInvalid(layout, [c])).toBe(false);
    const set = new Set(cells);
    for (const c of Array.from(layout.floor)) if (!set.has(c)) expect(referenceInvalid(layout, [c])).toBe(true);
  });
});

describe('block validation property', () => {
  // Feature: failures-telemetry, Property 7: Block validation agrees with a reference checker
  // **Validates: Requirements 1.6**
  it('Property 7: Block validation agrees with a reference checker', () => {
    const caseArb = fc.constantFrom(...PRESETS).chain((id) => {
      const l = loadPreset(id);
      const cellArb = fc.oneof(
        { weight: 6, arbitrary: fc.constantFrom(...Array.from(l.floor)) },
        { weight: 2, arbitrary: fc.integer({ min: 0, max: l.kinds.length - 1 }) },
        { weight: 1, arbitrary: fc.constantFrom(...Array.from(l.access)) },
      );
      return fc.tuple(fc.constant(id), fc.array(cellArb, { minLength: 1, maxLength: 3 }));
    });
    fc.assert(
      fc.property(caseArb, ([id, cells]) => {
        const l = loadPreset(id);
        const expected = referenceInvalid(l, cells);
        let threw = false;
        try {
          create(
            l,
            cells.map((c) => block(c)),
          );
        } catch {
          threw = true;
        }
        return threw === expected;
      }),
      { numRuns: 100 },
    );
  });
});
