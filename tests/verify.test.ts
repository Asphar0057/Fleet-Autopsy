import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRecorder, hashRecording, positionsAt, statesAt } from '../src/sim/recorder';
import type { Recording } from '../src/sim/recorder';
import { parseLayout } from '../src/sim/layout';
import { verifyRun } from '../src/sim/verify';
import { badgeText } from '../src/ui/badge';
import {
  createWaitCounter,
  meanCycleTime,
  queueLengths,
  stalledAt,
  throughputAt,
  throughputSeries,
} from '../src/sim/metrics';
import { EKind, RState } from '../src/sim/types';
import { metaFor } from './helpers';

describe('recorder', () => {
  it('throws RangeError outside the recorded range', () => {
    const r = createRecorder(2, 1);
    r.pushFrame(Int16Array.of(3, 4), Int16Array.of(5, 6), Uint8Array.of(0, 1), Uint8Array.of(0));
    expect(() => positionsAt(r.recording, -1)).toThrow(RangeError);
    expect(() => positionsAt(r.recording, 1)).toThrow(RangeError);
    expect(() => statesAt(r.recording, 1)).toThrow(RangeError);
    expect([...positionsAt(r.recording, 0)]).toEqual([3, 4]);
  });

  it('hash changes when any recorded value changes', () => {
    const make = (cell: number) => {
      const r = createRecorder(1, 1);
      r.pushFrame(Int16Array.of(cell), Int16Array.of(0), Uint8Array.of(0), Uint8Array.of(0));
      return hashRecording(r.recording);
    };
    expect(make(7)).toBe(make(7));
    expect(make(7)).not.toBe(make(8));
    expect(make(7)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('recorder properties', () => {
  // Feature: sim-core, Property 11: Recorder round trip
  // **Validates: Requirements 5.1, 5.2, 5.3, 5.5, 7.3**
  it('Property 11: Recorder round trip', () => {
    const input = fc
      .record({
        robots: fc.integer({ min: 1, max: 6 }),
        stations: fc.integer({ min: 1, max: 4 }),
        // More than the initial 256-slot buffers, so growth happens.
        frames: fc.integer({ min: 1, max: 700 }),
        events: fc.integer({ min: 0, max: 700 }),
      })
      .chain((g) =>
        fc.record({
          g: fc.constant(g),
          pos: fc.array(fc.integer({ min: -1, max: 896 }), {
            minLength: g.frames * g.robots,
            maxLength: g.frames * g.robots,
          }),
          state: fc.array(fc.integer({ min: 0, max: 4 }), {
            minLength: g.frames * g.robots,
            maxLength: g.frames * g.robots,
          }),
          queue: fc.array(fc.integer({ min: 0, max: 255 }), {
            minLength: g.frames * g.stations,
            maxLength: g.frames * g.stations,
          }),
          ev: fc.array(
            fc.tuple(
              fc.integer({ min: 0, max: 100000 }),
              fc.integer({ min: 0, max: 44 }),
              fc.integer({ min: 0, max: 4 }),
              fc.integer({ min: -1, max: 1 << 20 }),
            ),
            { minLength: g.events, maxLength: g.events },
          ),
        }),
      );
    fc.assert(
      fc.property(input, ({ g, pos, state, queue, ev }) => {
        const { robots, stations, frames } = g;
        const r = createRecorder(robots, stations);
        // Interleave events with frames; reuse the input buffers like the sim does.
        const p = new Int16Array(robots);
        const goal = new Int16Array(robots);
        const st = new Uint8Array(robots);
        const q = new Uint8Array(stations);
        let e = 0;
        for (let t = 0; t < frames; t++) {
          for (let i = 0; i < robots; i++) {
            p[i] = pos[t * robots + i];
            goal[i] = pos[t * robots + i] + 1;
            st[i] = state[t * robots + i];
          }
          for (let s = 0; s < stations; s++) q[s] = queue[t * stations + s];
          r.pushFrame(p, goal, st, q);
          const upto = Math.round(((t + 1) * ev.length) / frames);
          for (; e < upto; e++) r.pushEvent(...ev[e]);
        }
        const rec = r.recording;
        expect(rec.frames).toBe(frames);
        expect(rec.events).toBe(ev.length);
        for (let t = 0; t < frames; t++) {
          expect([...positionsAt(rec, t)]).toEqual(pos.slice(t * robots, (t + 1) * robots));
          expect([...statesAt(rec, t)]).toEqual(state.slice(t * robots, (t + 1) * robots));
          expect([...rec.goals.subarray(t * robots, (t + 1) * robots)]).toEqual(
            pos.slice(t * robots, (t + 1) * robots).map((c) => c + 1),
          );
          expect([...rec.queueLen.subarray(t * stations, (t + 1) * stations)]).toEqual(
            queue.slice(t * stations, (t + 1) * stations),
          );
        }
        for (let k = 0; k < ev.length; k++) {
          expect([rec.evTick[k], rec.evRobot[k], rec.evKind[k], rec.evArg[k]]).toEqual(ev[k]);
        }
        expect(() => positionsAt(rec, frames)).toThrow(RangeError);
        expect(() => statesAt(rec, -1)).toThrow(RangeError);
      }),
      { numRuns: 100 },
    );
  });
});

// Required test 2: hand-built recordings on a tiny grid.
//   #####     cells:  0  1  2  3  4
//   #p..#             5  6  7  8  9     6 = pod slot
//   #.#.#            10 11 12 13 14    12 = interior wall
//   #...#            15 16 17 18 19
//   #####
const GRID = '#####\n#p..#\n#.#.#\n#...#\n#####\n';
const tiny = parseLayout(metaFor(GRID), GRID);
const POD = 6;
const WALL = 12;

/** Builds a recording from frames of [cell, goal] per robot. */
function recordingOf(frames: [number, number][][]): Recording {
  const robots = frames[0].length;
  const r = createRecorder(robots, 0);
  const q = new Uint8Array(0);
  for (const f of frames) {
    r.pushFrame(
      Int16Array.from(f.map(([c]) => c)),
      Int16Array.from(f.map(([, g]) => g)),
      new Uint8Array(robots),
      q,
    );
  }
  return r.recording;
}

describe('verifyRun', () => {
  it('accepts a clean run', () => {
    const rec = recordingOf([
      [[7, 18], [16, 8]],
      [[8, 18], [17, 8]],
      [[13, 18], [18, 8]],
    ]);
    expect(verifyRun(rec, tiny)).toEqual([]);
  });

  it('flags same-cell with tick and both robot ids', () => {
    const rec = recordingOf([
      [[7, 18], [8, 18]],
      [[8, 18], [8, 18]],
    ]);
    expect(verifyRun(rec, tiny)).toEqual([{ kind: 'same-cell', tick: 1, robots: [0, 1] }]);
  });

  it('flags a swap with tick and both robot ids', () => {
    const rec = recordingOf([
      [[16, 18], [7, 18], [8, 16]],
      [[16, 18], [8, 18], [7, 16]],
    ]);
    expect(verifyRun(rec, tiny)).toEqual([{ kind: 'swap', tick: 1, robots: [1, 2] }]);
  });

  it('flags a jump (diagonal and two cells) with tick and robot id', () => {
    const rec = recordingOf([
      [[7, 18], [16, 18]],
      [[7, 18], [18, 18]],
      [[13, 18], [18, 18]],
    ]);
    expect(verifyRun(rec, tiny)).toEqual([
      { kind: 'jump', tick: 1, robots: [1] },
      { kind: 'jump', tick: 2, robots: [0] },
    ]);
  });

  it('flags a robot on a wall cell as illegal-cell', () => {
    const rec = recordingOf([[[11, 13]], [[WALL, 13]], [[13, 13]]]);
    expect(verifyRun(rec, tiny)).toEqual([{ kind: 'illegal-cell', tick: 1, robots: [0] }]);
  });

  it('allows an endpoint that is the goal, and staying there after the goal changes', () => {
    const rec = recordingOf([
      [[7, POD]],
      [[POD, POD]], // enters its goal
      [[POD, 18]], // picked: goal changed, still on the slot
      [[POD, 18]],
      [[7, 18]],
    ]);
    expect(verifyRun(rec, tiny)).toEqual([]);
  });

  it('flags entering an endpoint that is not the goal', () => {
    const rec = recordingOf([
      [[7, 18], [11, 13]],
      [[POD, 18], [16, 13]],
    ]);
    expect(verifyRun(rec, tiny)).toEqual([{ kind: 'illegal-cell', tick: 1, robots: [0] }]);
  });

  it('flags spawning on a non-goal endpoint at tick 0', () => {
    const rec = recordingOf([[[POD, 18]]]);
    expect(verifyRun(rec, tiny)).toEqual([{ kind: 'illegal-cell', tick: 0, robots: [0] }]);
  });
});

describe('badgeText', () => {
  it('reads VERIFIED with 0 violations', () => {
    expect(badgeText(0, 2000)).toEqual({ text: 'VERIFIED · 0 VIOLATIONS · 2000 TICKS', alert: false });
  });

  it('shows the violation count as an alert', () => {
    expect(badgeText(3, 214)).toEqual({ text: '3 VIOLATIONS · 214 TICKS', alert: true });
    expect(badgeText(1, 214)).toEqual({ text: '1 VIOLATION · 214 TICKS', alert: true });
  });
});

describe('metrics properties', () => {
  // Feature: sim-core, Property 13: Metrics match naive models
  // **Validates: Requirements 7.1, 7.2**
  it('Property 13: Metrics match naive models', () => {
    const input = fc.record({
      // [tick gap to previous event, kind, cycle length for service-end / arg otherwise]
      ev: fc.array(
        fc.tuple(
          fc.integer({ min: 0, max: 40 }),
          fc.integer({ min: 0, max: 4 }),
          fc.integer({ min: 0, max: 300 }),
        ),
        { maxLength: 300 },
      ),
      query: fc.integer({ min: 0, max: 1 << 30 }),
    });
    fc.assert(
      fc.property(input, ({ ev, query }) => {
        const r = createRecorder(1, 1);
        const events: { tick: number; kind: number; arg: number }[] = [];
        let tick = 0;
        for (const [gap, kind, x] of ev) {
          tick += gap;
          const arg = kind === EKind.ServiceEnd ? tick - x : x;
          events.push({ tick, kind, arg });
          r.pushEvent(tick, 0, kind, arg);
        }
        const last = tick + 150;
        const one16 = new Int16Array(1);
        const one8 = new Uint8Array(1);
        for (let t = 0; t <= last; t++) r.pushFrame(one16, one16, one8, one8);
        const rec = r.recording;
        const T = query % (last + 1);

        const naiveThroughput = (q: number) =>
          events.filter((e) => e.kind === EKind.Deliver && e.tick > q - 100 && e.tick <= q).length;
        expect(throughputAt(rec, T)).toBe(naiveThroughput(T));

        const ends = events.filter((e) => e.kind === EKind.ServiceEnd && e.tick <= T);
        const mean = meanCycleTime(rec, T);
        if (ends.length === 0) expect(mean).toBeNaN();
        else expect(mean).toBeCloseTo(ends.reduce((s, e) => s + e.tick - e.arg, 0) / ends.length, 9);

        const series = throughputSeries(rec, T);
        expect(series.length).toBe(T + 1);
        const stride = Math.max(1, Math.floor(T / 64));
        for (let t = 0; t <= T; t += stride) expect(series[t]).toBe(naiveThroughput(t));
        expect(series[T]).toBe(naiveThroughput(T));
      }),
      { numRuns: 100 },
    );
  });
});

describe('metrics', () => {
  it('queueLengths returns the recorded row and throws outside the range', () => {
    const r = createRecorder(1, 2);
    const c = new Int16Array(1);
    const s = new Uint8Array(1);
    r.pushFrame(c, c, s, Uint8Array.of(1, 2));
    r.pushFrame(c, c, s, Uint8Array.of(3, 0));
    expect([...queueLengths(r.recording, 1)]).toEqual([3, 0]);
    expect(() => queueLengths(r.recording, 2)).toThrow(RangeError);
    expect(() => queueLengths(r.recording, -1)).toThrow(RangeError);
  });

  it('meanCycleTime is NaN before any service-end', () => {
    const r = createRecorder(1, 1);
    r.pushEvent(5, 0, EKind.Deliver, 6);
    expect(meanCycleTime(r.recording, 10)).toBeNaN();
    r.pushEvent(12, 0, EKind.ServiceEnd, 2);
    expect(meanCycleTime(r.recording, 11)).toBeNaN();
    expect(meanCycleTime(r.recording, 12)).toBe(10);
  });

  it('wait counter: forward, repeated, and backward queries give exact counts', () => {
    const { ToPod, ToStation, Serving, Returning, Idle } = RState;
    // Per frame: [cell, state] for robots 0 and 1 on the tiny grid.
    const frames: [number, number][][] = [
      [[7, ToPod], [16, Idle]],
      [[7, ToPod], [16, Idle]], // r0 waits on 7; r1 idle: not counted
      [[8, ToPod], [16, ToPod]], // r0 moved; r1 waits on 16
      [[8, Serving], [16, ToStation]], // r0 serving: not counted; r1 waits on 16
      [[8, Returning], [17, ToStation]], // r0 waits on 8; r1 moved
    ];
    const r = createRecorder(2, 0);
    for (const f of frames) {
      r.pushFrame(
        Int16Array.from(f.map(([c]) => c)),
        Int16Array.from(f.map(([c]) => c)),
        Uint8Array.from(f.map(([, s]) => s)),
        new Uint8Array(0),
      );
    }
    const rec = r.recording;
    const expected: Record<number, Record<number, number>> = {
      0: {},
      1: { 7: 1 },
      2: { 7: 1, 16: 1 },
      3: { 7: 1, 16: 2 },
      4: { 7: 1, 16: 2, 8: 1 },
    };
    const dense = (t: number) => {
      const a = new Array<number>(25).fill(0);
      for (const [c, v] of Object.entries(expected[t])) a[Number(c)] = v;
      return a;
    };
    const wc = createWaitCounter(tiny);
    const first = wc.at(rec, 0);
    for (const t of [0, 1, 2, 4, 4, 1, 3, 0, 4]) {
      const got = wc.at(rec, t);
      expect(got).toBe(first); // owned and reused
      expect([...got]).toEqual(dense(t));
      expect([...createWaitCounter(tiny).at(rec, t)]).toEqual(dense(t));
    }
    expect(() => wc.at(rec, 5)).toThrow(RangeError);
  });
});

describe('stalledAt', () => {
  // Robot 0 stalls at frame 2 on cell 7, stays through frame 4, moves at 5, stalls again at 7.
  // Robot 1 has a stall event at frame 1 but moves at frame 3. Robot 2 never stalls.
  const cells = [
    [7, 16, 18],
    [7, 16, 18],
    [7, 16, 18],
    [7, 17, 18],
    [7, 17, 18],
    [8, 17, 13],
    [8, 17, 13],
    [8, 17, 13],
  ];
  const r = createRecorder(3, 0);
  for (const f of cells) {
    r.pushFrame(Int16Array.from(f), Int16Array.from(f), new Uint8Array(3), new Uint8Array(0));
  }
  r.pushEvent(1, 1, EKind.Stall, 16);
  r.pushEvent(2, 0, EKind.Stall, 7);
  r.pushEvent(3, 2, EKind.Pick, 6);
  r.pushEvent(7, 0, EKind.Stall, 8);
  const rec = r.recording;

  it('marks a robot stalled from its stall event until it moves', () => {
    const out = new Uint8Array(3);
    const expected: Record<number, number[]> = {
      0: [0, 0, 0],
      1: [0, 1, 0],
      2: [1, 1, 0],
      3: [1, 0, 0], // robot 1 moved
      4: [1, 0, 0],
      5: [0, 0, 0], // robot 0 moved
      6: [0, 0, 0],
      7: [1, 0, 0], // new stall event
    };
    for (const t of [0, 1, 2, 3, 4, 5, 6, 7, 2, 0]) {
      stalledAt(rec, t, out);
      expect([...out]).toEqual(expected[t]);
    }
  });

  it('throws RangeError outside the recorded range', () => {
    const out = new Uint8Array(3);
    expect(() => stalledAt(rec, 8, out)).toThrow(RangeError);
    expect(() => stalledAt(rec, -1, out)).toThrow(RangeError);
  });
});
