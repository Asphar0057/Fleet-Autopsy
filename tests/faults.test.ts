import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { blockableCells, createFaultState, isActive, validateFaults } from '../src/sim/faults';
import type { Layout } from '../src/sim/layout';
import { hashRecording } from '../src/sim/recorder';
import type { Recording } from '../src/sim/recorder';
import { createSim } from '../src/sim/sim';
import { EKind } from '../src/sim/types';
import type { FaultEvent } from '../src/sim/types';
import { verifyRun } from '../src/sim/verify';
import { loadPreset, PRESET_IDS, runCase, runCaseArb } from './helpers';
import type { RunCase } from './helpers';

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

// ---- Fault effects: freeze, slow robot, station slowdown (task 2) ----

const RUN_TICKS = 300;

function cellAt(rec: Recording, t: number, r: number): number {
  return rec.positions[t * rec.robots + r];
}

/** Task events (pick, service-start, service-end, deliver) of robot r with tick in [lo, hi). */
function taskEventsIn(rec: Recording, r: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = 0; e < rec.events; e++) {
    if (rec.evRobot[e] !== r || rec.evKind[e] === EKind.Stall) continue;
    if (rec.evTick[e] >= lo && rec.evTick[e] < hi) out.push(e);
  }
  return out;
}

/** End of the fault window clipped to the recording: frames [f.tick, end). */
function windowEnd(f: FaultEvent, rec: Recording): number {
  return f.duration === null ? rec.frames : Math.min(rec.frames, f.tick + f.duration);
}

/** Completed services as [startTick, duration, station], paired per robot. */
function services(rec: Recording): [number, number, number][] {
  const start = new Int32Array(rec.robots).fill(-1);
  const station = new Int32Array(rec.robots).fill(-1);
  const out: [number, number, number][] = [];
  for (let e = 0; e < rec.events; e++) {
    const r = rec.evRobot[e];
    if (rec.evKind[e] === EKind.ServiceStart) {
      start[r] = rec.evTick[e];
      station[r] = rec.evArg[e];
    } else if (rec.evKind[e] === EKind.ServiceEnd) {
      out.push([start[r], rec.evTick[e] - start[r], station[r]]);
      start[r] = -1;
    }
  }
  return out;
}

const tickArb = fc.integer({ min: 1, max: 250 });
const durationArb = fc.option(fc.integer({ min: 1, max: 100 }), { nil: null });

function withFault<F extends FaultEvent>(make: (c: RunCase) => fc.Arbitrary<F>): fc.Arbitrary<[RunCase, F]> {
  return runCaseArb().chain((c) => fc.tuple(fc.constant(c), make(c)));
}

describe('createFaultState', () => {
  it('ORs pins and multiplies overlapping factors, independent of order', () => {
    const l = loadPreset('pocket-dc');
    const faults: FaultEvent[] = [
      { kind: 'station-slowdown', tick: 5, station: 0, factor: 2, duration: null },
      { kind: 'station-slowdown', tick: 1, station: 0, factor: 3, duration: 10 },
      { kind: 'robot-freeze', tick: 3, robot: 1, duration: 2 },
      { kind: 'slow-robot', tick: 1, robot: 0, period: 3, duration: null },
    ];
    for (const fs of [faults, [...faults].reverse()]) {
      const st = createFaultState(l, 2, fs);
      const pos = new Int16Array(2);
      st.update(4, pos);
      expect(Array.from(st.frozen)).toEqual([0, 1]);
      expect(Array.from(st.slowPin)).toEqual([1, 0]);
      expect(st.factor[0]).toBe(3);
      st.update(6, pos);
      expect(Array.from(st.frozen)).toEqual([0, 0]);
      expect(Array.from(st.slowPin)).toEqual([0, 0]);
      expect(st.factor[0]).toBe(6);
      expect(st.factor[1]).toBe(1);
      expect(st.update(20, pos)).toBe(false);
      expect(st.factor[0]).toBe(2);
      expect(st.blocked.every((b) => b === 0)).toBe(true);
    }
  });
});

describe('fault effects in the sim', () => {
  const c: RunCase = { id: 'fulfillment-block', seed: 1, robots: loadPreset('fulfillment-block').recommendedRobots };

  it('freeze keeps the robot in place, never pushed, with its task paused', () => {
    const f: FaultEvent = { kind: 'robot-freeze', tick: 60, robot: 3, duration: 120 };
    const rec = runCase(c, RUN_TICKS, [f]).recording;
    const here = cellAt(rec, f.tick - 1, 3);
    for (let t = f.tick; t < windowEnd(f, rec); t++) expect(cellAt(rec, t, 3)).toBe(here);
    expect(taskEventsIn(rec, 3, f.tick, windowEnd(f, rec))).toEqual([]);
    expect(verifyRun(rec, loadPreset(c.id))).toEqual([]);
    // The robot resumes after the window.
    let moved = false;
    for (let t = windowEnd(f, rec); t < rec.frames; t++) if (cellAt(rec, t, 3) !== here) moved = true;
    expect(moved).toBe(true);
  });

  it('slow robot moves only on multiples of the period', () => {
    const f: FaultEvent = { kind: 'slow-robot', tick: 20, robot: 5, period: 3, duration: null };
    const rec = runCase(c, RUN_TICKS, [f]).recording;
    let moves = 0;
    for (let t = f.tick; t < rec.frames; t++) {
      if (cellAt(rec, t, 5) !== cellAt(rec, t - 1, 5)) {
        moves++;
        expect(t % 3).toBe(0);
      }
    }
    expect(moves).toBeGreaterThan(0);
  });

  it('slowdown scales only services started in the window', () => {
    const f: FaultEvent = { kind: 'station-slowdown', tick: 80, station: 0, factor: 3, duration: 120 };
    const rec = runCase(c, RUN_TICKS, [f]).recording;
    let scaled = 0;
    for (const [start, d, s] of services(rec)) {
      if (s === 0 && start >= 80 && start < 200) {
        scaled++;
        expect(d % 3).toBe(0);
        expect(d / 3).toBeGreaterThanOrEqual(8);
        expect(d / 3).toBeLessThanOrEqual(14);
      } else {
        expect(d).toBeGreaterThanOrEqual(8);
        expect(d).toBeLessThanOrEqual(14);
      }
    }
    expect(scaled).toBeGreaterThan(0);
  });

  it('a faults array that takes effect changes the hash', () => {
    const base = hashRecording(runCase(c, RUN_TICKS).recording);
    const kinds: FaultEvent[] = [
      { kind: 'robot-freeze', tick: 10, robot: 0, duration: null },
      { kind: 'slow-robot', tick: 10, robot: 0, period: 2, duration: null },
      { kind: 'station-slowdown', tick: 10, station: 0, factor: 2, duration: null },
    ];
    for (const f of kinds) expect(hashRecording(runCase(c, RUN_TICKS, [f]).recording)).not.toBe(base);
  });
});

describe('fault effect properties', () => {
  // Feature: failures-telemetry, Property 3: Frozen robots stay put and pause their task
  // **Validates: Requirements 1.2**
  it('Property 3: Frozen robots stay put and pause their task', () => {
    const arb = withFault((c) =>
      fc.record({
        kind: fc.constant('robot-freeze' as const),
        tick: tickArb,
        robot: fc.integer({ min: 0, max: c.robots - 1 }),
        duration: durationArb,
      }),
    );
    fc.assert(
      fc.property(arb, ([c, f]) => {
        const rec = runCase(c, RUN_TICKS, [f]).recording;
        const end = windowEnd(f, rec);
        const here = cellAt(rec, f.tick - 1, f.robot);
        for (let t = f.tick; t < end; t++) if (cellAt(rec, t, f.robot) !== here) return false;
        return taskEventsIn(rec, f.robot, f.tick, end).length === 0;
      }),
      { numRuns: 25 },
    );
  });

  // Feature: failures-telemetry, Property 4: Slow robots move only on period ticks
  // **Validates: Requirements 1.5**
  it('Property 4: Slow robots move only on period ticks', () => {
    const arb = withFault((c) =>
      fc.record({
        kind: fc.constant('slow-robot' as const),
        tick: tickArb,
        robot: fc.integer({ min: 0, max: c.robots - 1 }),
        period: fc.integer({ min: 2, max: 4 }),
        duration: durationArb,
      }),
    );
    fc.assert(
      fc.property(arb, ([c, f]) => {
        const rec = runCase(c, RUN_TICKS, [f]).recording;
        for (let t = f.tick; t < windowEnd(f, rec); t++) {
          if (cellAt(rec, t, f.robot) !== cellAt(rec, t - 1, f.robot) && t % f.period !== 0) return false;
        }
        return true;
      }),
      { numRuns: 25 },
    );
  });

  // Feature: failures-telemetry, Property 5: Station slowdown scales only services started while active
  // **Validates: Requirements 1.3**
  it('Property 5: Station slowdown scales only services started while active', () => {
    const arb = withFault((c) =>
      fc.record({
        kind: fc.constant('station-slowdown' as const),
        tick: tickArb,
        station: fc.integer({ min: 0, max: loadPreset(c.id).stations.length - 1 }),
        factor: fc.integer({ min: 2, max: 4 }),
        duration: durationArb,
      }),
    );
    fc.assert(
      fc.property(arb, ([c, f]) => {
        const rec = runCase(c, RUN_TICKS, [f]).recording;
        for (const [start, d, s] of services(rec)) {
          if (s === f.station && isActive(f, start)) {
            if (d % f.factor !== 0 || d / f.factor < 8 || d / f.factor > 14) return false;
          } else if (d < 8 || d > 14) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 25 },
    );
  });
});
