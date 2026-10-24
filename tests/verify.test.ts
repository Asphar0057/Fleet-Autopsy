import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRecorder, hashRecording, positionsAt, statesAt } from '../src/sim/recorder';
import type { Recording } from '../src/sim/recorder';
import { parseLayout } from '../src/sim/layout';
import { verifyRun } from '../src/sim/verify';
import { badgeText } from '../src/ui/badge';
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
