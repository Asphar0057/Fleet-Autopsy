import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRecorder } from '../src/sim/recorder';
import type { Recording } from '../src/sim/recorder';
import { runHeadless } from '../src/sim/sim';
import {
  createTelemetryTracker,
  deriveTelemetry,
  jamWindow,
  SERVICE_SAMPLES,
  STANDSTILL_LONG,
  STANDSTILL_SHORT,
} from '../src/sim/telemetry';
import type { Telemetry } from '../src/sim/telemetry';
import { EKind, RState } from '../src/sim/types';
import { faultArb, loadPreset, PRESET_IDS, runCaseArb } from './helpers';

const pocket = loadPreset('pocket-dc');

/** Hand-built one-robot, one-station recording from per-frame (cell, state) pairs. */
function handRecording(frames: [number, number][], events: [number, number, number][] = []): Recording {
  const r = createRecorder(1, 1);
  const pos = new Int16Array(1);
  const st = new Uint8Array(1);
  const q = new Uint8Array(1);
  for (const [cell, state] of frames) {
    pos[0] = cell;
    st[0] = state;
    r.pushFrame(pos, pos, st, q);
  }
  for (const [tick, kind, arg] of events) r.pushEvent(tick, 0, kind, arg);
  return r.recording;
}

describe('telemetry examples', () => {
  it('jamWindow is 100 for every preset (D18)', () => {
    for (const id of PRESET_IDS) expect(jamWindow(loadPreset(id))).toBe(100);
  });

  it('standstill counts still, busy frames and resets on move, serving, and idle', () => {
    const a = pocket.floor[0];
    const b = pocket.floor[1];
    const { ToPod, Serving, Returning, Idle } = RState;
    const rec = handRecording([
      [a, ToPod], // 0: frame 0 is 0
      [a, ToPod], // 1
      [a, ToPod], // 2
      [a, ToPod], // 3
      [b, ToPod], // 4: move
      [b, ToPod], // 5
      [b, ToPod], // 6
      [b, Serving], // 7: serving
      [b, Returning], // 8
      [b, Idle], // 9: idle
      [b, ToPod], // 10
    ]);
    const expected = [0, 1, 2, 3, 0, 1, 2, 0, 1, 0, 1];
    const tr = createTelemetryTracker(rec, pocket);
    for (let t = 0; t < expected.length; t++) {
      expect(tr.advance(t).standstill[0]).toBe(expected[t]);
      expect(deriveTelemetry(rec, pocket, t).standstill[0]).toBe(expected[t]);
    }
  });

  it('stalled20 and stalled100 count robots at the thresholds', () => {
    const a = pocket.floor[0];
    const frames: [number, number][] = Array.from({ length: 121 }, () => [a, RState.ToStation]);
    const tel = deriveTelemetry(handRecording(frames), pocket, 120);
    expect(tel.stalled20[STANDSTILL_SHORT - 1]).toBe(0);
    expect(tel.stalled20[STANDSTILL_SHORT]).toBe(1);
    expect(tel.stalled100[STANDSTILL_LONG - 1]).toBe(0);
    expect(tel.stalled100[STANDSTILL_LONG]).toBe(1);
    expect(tel.waits[a]).toBe(120);
  });

  it('service ring keeps the last 5 durations; completions use the trailing 100 ticks', () => {
    const a = pocket.floor[0];
    const frames: [number, number][] = Array.from({ length: 200 }, () => [a, RState.Serving]);
    // Seven services at station 0 with durations 1..7, starting every 10 ticks.
    const events: [number, number, number][] = [];
    for (let k = 0; k < 7; k++) {
      const start = 10 + 10 * k;
      events.push([start, EKind.ServiceStart, 0]);
      events.push([start + k + 1, EKind.ServiceEnd, start]);
    }
    const rec = handRecording(frames, events);
    const tr = createTelemetryTracker(rec, pocket);
    expect(tr.advance(5).serviceMean[0]).toBeNaN();
    expect(tr.advance(22).serviceMean[0]).toBe(1.5); // durations 1, 2
    const tel = tr.advance(199);
    expect(SERVICE_SAMPLES).toBe(5);
    expect(tel.serviceMean[0]).toBe((3 + 4 + 5 + 6 + 7) / 5);
    // Ends at 11, 22, 33, 44, 55, 66, 77; (99, 199] holds none, (0, 100] holds all 7.
    expect(tel.completions[0]).toBe(0);
    expect(tr.advance(100).completions[0]).toBe(7);
    expect(tr.advance(140).completions[0]).toBe(4); // 44, 55, 66, 77
  });

  it('throws RangeError outside [0, frames)', () => {
    const rec = handRecording([
      [pocket.floor[0], RState.Idle],
      [pocket.floor[0], RState.Idle],
    ]);
    const tr = createTelemetryTracker(rec, pocket);
    expect(() => tr.advance(-1)).toThrow(RangeError);
    expect(() => tr.advance(2)).toThrow(RangeError);
    expect(() => tr.advance(0.5)).toThrow(RangeError);
    expect(() => deriveTelemetry(rec, pocket, 2)).toThrow(RangeError);
  });

  it('follows a live recording that reallocates its buffers', () => {
    const layout = loadPreset('pocket-dc');
    const r = createRecorder(1, 1);
    const pos = new Int16Array([layout.floor[0]]);
    const st = new Uint8Array([RState.ToPod]);
    const q = new Uint8Array(1);
    const tr = createTelemetryTracker(r.recording, layout);
    for (let t = 0; t < 600; t++) {
      r.pushFrame(pos, pos, st, q);
      expect(tr.advance(t).standstill[0]).toBe(t);
    }
  });

  it('logs the time to derive 2,000 ticks x 45 robots', () => {
    const layout = loadPreset('fulfillment-block');
    const rec = runHeadless(layout, { seed: 1, robots: 45, queueCap: layout.queueCap, faults: [] }, 2000);
    const t0 = performance.now();
    const tel = deriveTelemetry(rec, layout, 2000);
    const ms = performance.now() - t0;
    console.log(`telemetry: derive 2,000 ticks x 45 robots on ${layout.id}: ${ms.toFixed(1)} ms`);
    expect(tel.throughput.length).toBe(2001);
  });
});

// ---- Property 9 ----

interface Snapshot {
  throughput: number[];
  stalled20: number[];
  stalled100: number[];
  queueLen: number[];
  standstill: number[];
  serviceMean: number[];
  completions: number[];
  waits: number[];
}

function snap(t: Telemetry): Snapshot {
  return {
    throughput: Array.from(t.throughput),
    stalled20: Array.from(t.stalled20),
    stalled100: Array.from(t.stalled100),
    queueLen: Array.from(t.queueLen),
    standstill: Array.from(t.standstill),
    serviceMean: Array.from(t.serviceMean),
    completions: Array.from(t.completions),
    waits: Array.from(t.waits),
  };
}

/** Independent recount from the raw recording, with plain arrays and no cursors. */
function naive(rec: Recording, cells: number, upTo: number): Snapshot {
  const n = rec.robots;
  const S = rec.stations;
  const W = 100;
  const ev = Array.from({ length: rec.events }, (_, e) => ({
    tick: rec.evTick[e],
    robot: rec.evRobot[e],
    kind: rec.evKind[e],
    arg: rec.evArg[e],
  })).filter((e) => e.tick <= upTo);
  const cell = (t: number, r: number) => rec.positions[t * n + r];
  const state = (t: number, r: number) => rec.states[t * n + r];
  const still = (t: number, r: number) => {
    let k = 0;
    for (let u = t; u > 0; u--) {
      const s = state(u, r);
      if (cell(u, r) !== cell(u - 1, r) || s === RState.Serving || s === RState.Idle) break;
      k++;
    }
    return k;
  };
  const throughput: number[] = [];
  const stalled20: number[] = [];
  const stalled100: number[] = [];
  for (let t = 0; t <= upTo; t++) {
    throughput.push(ev.filter((e) => e.kind === EKind.Deliver && e.tick > t - W && e.tick <= t).length);
    let a = 0;
    let b = 0;
    for (let r = 0; r < n; r++) {
      const k = still(t, r);
      if (k >= 20) a++;
      if (k >= 100) b++;
    }
    stalled20.push(a);
    stalled100.push(b);
  }
  // Pair each service-end with the robot's latest earlier service-start.
  const durations: number[][] = Array.from({ length: S }, () => []);
  const completions = new Array<number>(S).fill(0);
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.kind !== EKind.ServiceEnd) continue;
    let j = i - 1;
    while (j >= 0 && !(ev[j].robot === e.robot && ev[j].kind === EKind.ServiceStart)) j--;
    if (j < 0) continue;
    const s = ev[j].arg;
    durations[s].push(e.tick - ev[j].tick);
    if (e.tick > upTo - 100) completions[s]++;
  }
  const serviceMean = durations.map((d) => {
    const lastFive = d.slice(-5);
    return lastFive.length === 0 ? NaN : lastFive.reduce((x, y) => x + y, 0) / lastFive.length;
  });
  const waits = new Array<number>(cells).fill(0);
  for (let t = 1; t <= upTo; t++) {
    for (let r = 0; r < n; r++) {
      const s = state(t, r);
      if (cell(t, r) === cell(t - 1, r) && s !== RState.Serving && s !== RState.Idle) waits[cell(t, r)]++;
    }
  }
  return {
    throughput,
    stalled20,
    stalled100,
    queueLen: Array.from(rec.queueLen.subarray(0, (upTo + 1) * S)),
    standstill: Array.from({ length: n }, (_, r) => still(upTo, r)),
    serviceMean,
    completions,
    waits,
  };
}

describe('telemetry properties', () => {
  // Feature: failures-telemetry, Property 9: Telemetry matches a naive recount
  // **Validates: Requirements 3.2, 3.3, 3.4**
  it('Property 9: tracker equals deriveTelemetry and a naive recount for any query order', () => {
    const TICKS = 300;
    const arb = runCaseArb().chain((c) =>
      fc.tuple(
        fc.constant(c),
        faultArb(loadPreset(c.id), c.robots),
        fc.array(fc.integer({ min: 0, max: TICKS }), { minLength: 1, maxLength: 8 }),
      ),
    );
    fc.assert(
      fc.property(arb, ([c, faults, queries]) => {
        const layout = loadPreset(c.id);
        const rec = runHeadless(layout, { seed: c.seed, robots: c.robots, queueCap: layout.queueCap, faults }, TICKS);
        const tr = createTelemetryTracker(rec, layout);
        for (const t of queries) {
          const got = snap(tr.advance(t));
          expect(got).toEqual(snap(deriveTelemetry(rec, layout, t)));
          expect(got).toEqual(naive(rec, layout.width * layout.height, t));
        }
      }),
      { numRuns: 25 },
    );
  });
});
