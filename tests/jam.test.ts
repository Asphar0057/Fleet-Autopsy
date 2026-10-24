import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRecorder } from '../src/sim/recorder';
import type { Recording } from '../src/sim/recorder';
import { runHeadless } from '../src/sim/sim';
import { deriveTelemetry } from '../src/sim/telemetry';
import {
  BASE_FROM,
  BASE_LAG,
  BASE_MIN,
  baselineAt,
  detectJam,
  DROP_TICKS,
  STALL_ROBOTS,
} from '../src/sim/jam';
import type { Jam, JamSignal } from '../src/sim/jam';
import { SCENARIOS, scenarioConfig } from '../src/sim/scenarios';
import { EKind, RState } from '../src/sim/types';
import { loadPreset, PRESET_IDS } from './helpers';

const pocket = loadPreset('pocket-dc');
const CELL_A = pocket.floor[0];
const CELL_B = pocket.floor[1];

// ---- synthetic recordings ----

interface Episode {
  start: number;
  len: number;
}

interface Synth {
  ticks: number; // frames = ticks + 1
  robots: number;
  gap: number; // one delivery every `gap` ticks
  drops: (Episode & { gap: number })[]; // gap 0: no deliveries
  stills: Episode[][]; // per robot: frames where it stays still in a busy state
  massStill: Episode | null; // every robot still
}

/** Builds a Recording: robots alternate two cells unless in a still episode. */
function buildRecording(s: Synth): Recording {
  const r = createRecorder(s.robots, 1);
  const pos = new Int16Array(s.robots).fill(CELL_A);
  const st = new Uint8Array(s.robots);
  const q = new Uint8Array(1);
  const inside = (e: Episode | null, t: number) => e !== null && t >= e.start && t < e.start + e.len;
  for (let t = 0; t <= s.ticks; t++) {
    for (let i = 0; i < s.robots; i++) {
      const still = t > 0 && (inside(s.massStill, t) || s.stills[i].some((e) => inside(e, t)));
      if (still) {
        st[i] = RState.ToStation;
      } else {
        st[i] = RState.ToPod;
        pos[i] = t % 2 === 0 ? CELL_A : CELL_B;
      }
    }
    r.pushFrame(pos, pos, st, q);
  }
  for (let t = 1; t <= s.ticks; t++) {
    let gap = s.gap;
    for (const d of s.drops) if (inside(d, t)) gap = d.gap;
    if (gap > 0 && t % gap === 0) r.pushEvent(t, 0, EKind.Deliver, 0);
  }
  return r.recording;
}

const synthArb: fc.Arbitrary<Synth> = fc
  .record({
    ticks: fc.integer({ min: 400, max: 1200 }),
    robots: fc.integer({ min: 3, max: 5 }),
    gap: fc.integer({ min: 2, max: 6 }),
  })
  .chain(({ ticks, robots, gap }) => {
    const ep = (minLen: number, maxLen: number) =>
      fc.record({ start: fc.integer({ min: 1, max: ticks }), len: fc.integer({ min: minLen, max: maxLen }) });
    return fc.record({
      ticks: fc.constant(ticks),
      robots: fc.constant(robots),
      gap: fc.constant(gap),
      drops: fc.array(
        fc.record({
          start: fc.integer({ min: 1, max: ticks }),
          len: fc.integer({ min: 20, max: 500 }),
          gap: fc.oneof(fc.constant(0), fc.integer({ min: gap + 1, max: gap * 4 })),
        }),
        { maxLength: 2 },
      ),
      stills: fc.array(fc.array(ep(20, 250), { maxLength: 2 }), { minLength: robots, maxLength: robots }),
      massStill: fc.option(ep(50, 200), { nil: null }),
    });
  });

/** Naive reference (Property 10): Baseline by sorting at every tick, D17 rules and onset walk. */
function reference(rec: Recording, upTo: number): Jam | null {
  const tel = deriveTelemetry(rec, pocket, upTo);
  const tp = Array.from(tel.throughput);
  const s100 = Array.from(tel.stalled100);
  const base = (t: number): number | null => {
    const vals = tp.slice(BASE_FROM, t - BASE_LAG + 1);
    if (t - BASE_LAG < BASE_FROM || vals.length < BASE_MIN) return null;
    vals.sort((a, b) => a - b);
    return vals[Math.floor((vals.length - 1) / 2)];
  };
  // Ratios as exact integer comparisons: tp < 0.6 B  <=>  5 tp < 3 B; tp >= 0.9 B  <=>  10 tp >= 9 B.
  const drop = (t: number): boolean => {
    const b = base(t);
    return b !== null && 5 * tp[t] < 3 * b;
  };
  for (let d = 0; d <= upTo; d++) {
    let r1 = d >= DROP_TICKS - 1;
    for (let k = 0; r1 && k < DROP_TICKS; k++) if (!drop(d - k)) r1 = false;
    const r2 = s100[d] >= STALL_ROBOTS;
    if (!r1 && !r2) continue;
    const signals: JamSignal[] = [];
    if (r1) signals.push('throughput');
    if (r2) signals.push('standstill');
    const b = base(d);
    if (b === null) return { onsetTick: Math.max(0, d - 100), detectedTick: d, severity: 0, signals };
    let onsetTick = 0;
    for (let u = r1 ? d - DROP_TICKS + 1 : d; u >= 0; u--) {
      if (10 * tp[u] >= 9 * b) {
        onsetTick = u;
        break;
      }
    }
    const severity = b === 0 ? 0 : Math.min(1, Math.max(0, 1 - tp[upTo] / b));
    return { onsetTick, detectedTick: d, severity, signals };
  }
  return null;
}

// ---- examples ----

describe('jam detector examples', () => {
  it('baselineAt is NaN before tick 349 and the lower median after', () => {
    const tp = new Int16Array(500);
    for (let t = 0; t < 500; t++) tp[t] = t % 10; // 0..9 repeating
    expect(baselineAt(tp, 348)).toBeNaN();
    // ticks 150..249: ten copies of 0..9, lower median of 100 values is 4.
    expect(baselineAt(tp, 349)).toBe(4);
    expect(() => baselineAt(tp, 500)).toThrow(RangeError);
  });

  it('steady deliveries give no jam; a total stop is detected with throughput signal', () => {
    const steady: Synth = { ticks: 1000, robots: 3, gap: 4, drops: [], stills: [[], [], []], massStill: null };
    expect(detectJam(buildRecording(steady), pocket, 1000)).toBeNull();

    const stop = { ...steady, drops: [{ start: 600, len: 1000, gap: 0 }] };
    const rec = buildRecording(stop);
    const jam = detectJam(rec, pocket, 1000);
    // Baseline 25 (one delivery every 4 ticks), last delivery at 596. tp < 15 from
    // t = 640, so the 40-tick run completes at 679; tp >= 23 last holds at 607.
    expect(jam).toEqual({ onsetTick: 607, detectedTick: 679, severity: 1, signals: ['throughput'] });
    expect(jam).toEqual(reference(rec, 1000));
    // Latched: later ticks return the same detection; passing telemetry gives the same result.
    expect(detectJam(rec, pocket, 900)!.detectedTick).toBe(jam!.detectedTick);
    expect(detectJam(rec, pocket, 900, deriveTelemetry(rec, pocket, 1000))).toEqual(detectJam(rec, pocket, 900));
  });

  it('three long standstills fire the standstill rule, with onset 100 back before a Baseline', () => {
    const s: Synth = { ticks: 400, robots: 3, gap: 4, drops: [], stills: [[], [], []], massStill: { start: 50, len: 300 } };
    const jam = detectJam(buildRecording(s), pocket, 400);
    expect(jam).toEqual({ onsetTick: 49, detectedTick: 149, severity: 0, signals: ['standstill'] });
  });

  it('throws RangeError outside [0, frames) and for telemetry that ends early', () => {
    const rec = buildRecording({ ticks: 10, robots: 3, gap: 2, drops: [], stills: [[], [], []], massStill: null });
    expect(() => detectJam(rec, pocket, -1)).toThrow(RangeError);
    expect(() => detectJam(rec, pocket, 11)).toThrow(RangeError);
    expect(() => detectJam(rec, pocket, 5, deriveTelemetry(rec, pocket, 4))).toThrow(RangeError);
  });
});

// ---- Property 10 ----

describe('jam detector properties', () => {
  // Feature: failures-telemetry, Property 10: Jam detector matches a reference model
  // **Validates: Requirements 4.1, 4.2, 4.3**
  it('Property 10: Jam detector matches a reference model', () => {
    let jams = 0;
    let none = 0;
    const signals = new Map<string, number>();
    fc.assert(
      fc.property(
        synthArb.chain((s) => fc.tuple(fc.constant(s), fc.integer({ min: 0, max: s.ticks }))),
        ([s, upTo]) => {
          const rec = buildRecording(s);
          const got = detectJam(rec, pocket, upTo);
          expect(got).toEqual(reference(rec, upTo));
          if (got) {
            jams++;
            const key = got.signals.join('+');
            signals.set(key, (signals.get(key) ?? 0) + 1);
          } else {
            none++;
          }
        },
      ),
      { numRuns: 100 },
    );
    console.log(`property 10: ${jams} jams (${[...signals].map(([k, v]) => `${k} ${v}`).join(', ')}), ${none} no jam`);
  }, 60_000);
});

// ---- healthy-baseline gate (Requirement 4.4) ----

const HEALTHY: [string, number][] = [];
for (const id of PRESET_IDS) for (let seed = 1; seed <= 5; seed++) HEALTHY.push([id, seed]);

describe('healthy baselines (Requirement 4.4)', () => {
  it.each(HEALTHY)(
    '%s seed %i: no jam over 2,000 ticks',
    (id, seed) => {
      const layout = loadPreset(id);
      const rec = runHeadless(layout, { seed, robots: layout.recommendedRobots, queueCap: layout.queueCap, faults: [] }, 2000);
      const tel = deriveTelemetry(rec, layout, 2000);
      let minRatio = Infinity;
      let minAt = -1;
      for (let t = 0; t <= 2000; t++) {
        const b = baselineAt(tel.throughput, t);
        if (Number.isNaN(b) || b === 0) continue;
        const ratio = tel.throughput[t] / b;
        if (ratio < minRatio) {
          minRatio = ratio;
          minAt = t;
        }
      }
      const maxStalled = Math.max(...tel.stalled100);
      const jam = detectJam(rec, layout, 2000, tel);
      console.log(
        `healthy ${id} seed ${seed}: min tp/baseline ${minRatio.toFixed(3)} at t=${minAt}, ` +
          `max stalled100 ${maxStalled}, jam ${jam ? JSON.stringify(jam) : 'none'}`,
      );
      expect(jam).toBeNull();
    },
    120_000,
  );
});

// ---- curated scenarios (Requirements 4.5, 4.6) ----

describe('curated scenarios are detected', () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))(
    '%s: detected within 200 ticks after the primary fault',
    (_id, s) => {
      const layout = loadPreset(s.layoutId);
      const rec = runHeadless(layout, scenarioConfig(s, layout), 2000);
      const jam = detectJam(rec, layout, 2000);
      const primary = s.faults[s.groundTruth.primaryFaultIndex].tick;
      console.log(`${s.id}: primary t=${primary}, jam ${JSON.stringify(jam)}`);
      expect(jam).not.toBeNull();
      const lag = jam!.detectedTick - primary;
      expect(lag).toBeGreaterThanOrEqual(0);
      expect(lag).toBeLessThanOrEqual(200);
      for (const d of s.groundTruth.decoyIndices) {
        // Requirement 4.6: onset closer to the primary than to the decoy.
        const decoy = s.faults[d].tick;
        expect(Math.abs(jam!.onsetTick - primary)).toBeLessThan(Math.abs(jam!.onsetTick - decoy));
      }
    },
    60_000,
  );
});
