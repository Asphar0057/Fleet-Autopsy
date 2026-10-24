import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { extractEvidence, SERVE_STALL, STALL_MIN } from '../src/diagnosis/evidence';
import type { Jam } from '../src/sim/jam';
import { detectJam } from '../src/sim/jam';
import type { Recording } from '../src/sim/recorder';
import { mulberry32, randInt } from '../src/sim/rng';
import { SCENARIOS, scenarioConfig } from '../src/sim/scenarios';
import { runHeadless } from '../src/sim/sim';
import { RState } from '../src/sim/types';
import type { FaultEvent } from '../src/sim/types';
import { loadPreset, seedArb } from './helpers';

// ---- curated examples ----

const curated = new Map<string, { rec: Recording; jam: Jam }>();

/** Runs a curated scenario 2000 ticks and detects its jam, once per test file. */
function curatedRun(id: string): { rec: Recording; jam: Jam } {
  let c = curated.get(id);
  if (!c) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario ${id}`);
    const layout = loadPreset(s.layoutId);
    const rec = runHeadless(layout, scenarioConfig(s, layout), 2000);
    const jam = detectJam(rec, layout, 2000);
    if (!jam) throw new Error(`${id}: no jam`);
    c = { rec, jam };
    curated.set(id, c);
  }
  return c;
}

describe('extractEvidence examples', () => {
  it('cp-door-freeze: the earliest stalled robot is R7, standing still from the freeze', () => {
    const { rec, jam } = curatedRun('cp-door-freeze');
    const layout = loadPreset('chokepoint');
    const ev = extractEvidence(rec, layout, jam);
    console.log(
      `cp-door-freeze: jam ${JSON.stringify(jam)}, stalled ${JSON.stringify(
        ev.stalled.map((r) => [r, ev.standstillStart[r], ev.standstillCell[r]]),
      )}`,
    );
    expect(ev.stalled[0]).toBe(7);
    expect(ev.standstillStart[7]).toBeLessThanOrEqual(351);
    expect(ev.standstillCell[7]).toBe(192);
  }, 60_000);

  it('pd-holder-freeze: R4 is stalled while Serving', () => {
    const { rec, jam } = curatedRun('pd-holder-freeze');
    const layout = loadPreset('pocket-dc');
    const ev = extractEvidence(rec, layout, jam);
    console.log(`pd-holder-freeze: jam ${JSON.stringify(jam)}, stalled ${JSON.stringify(ev.stalled)}`);
    expect(ev.stalled).toContain(4);
    expect(rec.states[jam.detectedTick * rec.robots + 4]).toBe(RState.Serving);
    const ep = ev.episodes.find((e) => e.robot === 4 && e.end === jam.detectedTick);
    expect(ep?.serving).toBe(true);
    expect(ev.standstillStart[4]).toBeLessThanOrEqual(400);
    // Station series cover every station; completions count closed services only.
    expect(ev.services).toHaveLength(layout.stations.length);
    for (let s = 0; s < layout.stations.length; s++) {
      expect(ev.completions[s]).toBe(ev.services[s].filter((x) => x.end >= 0).length);
    }
    expect(ev.throughput).toHaveLength(jam.detectedTick + 1);
  }, 60_000);

  it('throws RangeError when detectedTick is outside the recording', () => {
    const layout = loadPreset('pocket-dc');
    const rec = runHeadless(layout, { seed: 1, robots: 3, queueCap: layout.queueCap, faults: [] }, 10);
    const jam = (d: number): Jam => ({ onsetTick: 0, detectedTick: d, severity: 0, signals: [] });
    expect(() => extractEvidence(rec, layout, jam(-1))).toThrow(RangeError);
    expect(() => extractEvidence(rec, layout, jam(11))).toThrow(RangeError);
    expect(() => extractEvidence(rec, layout, jam(10))).not.toThrow();
  });
});

// ---- properties ----

interface EvCase {
  id: string;
  seed: number;
  robots: number;
  ticks: number;
  d: number;
  onset: number;
  noise: number;
  freeze: { tick: number; robot: number } | null;
}

/** Run-level cases on pocket-dc and chokepoint, 300 to 600 ticks, a jam tick d and onset <= d. */
const evCaseArb: fc.Arbitrary<EvCase> = fc
  .record({
    id: fc.constantFrom('pocket-dc', 'chokepoint'),
    seed: seedArb,
    ticks: fc.integer({ min: 300, max: 600 }),
    noise: seedArb,
  })
  .chain((b) =>
    fc.record({
      id: fc.constant(b.id),
      seed: fc.constant(b.seed),
      ticks: fc.constant(b.ticks),
      noise: fc.constant(b.noise),
      robots: fc.integer({ min: 2, max: loadPreset(b.id).recommendedRobots }),
      d: fc.integer({ min: 0, max: b.ticks }),
      // A frozen robot (robot index taken modulo the robot count) so stalls actually occur.
      freeze: fc.option(fc.record({ tick: fc.integer({ min: 1, max: 250 }), robot: fc.nat(100) }), { nil: null }),
    }),
  )
  .chain((c) => fc.record({ ...mapConst(c), onset: fc.integer({ min: 0, max: c.d }) }));

function mapConst<T extends object>(o: T): { [K in keyof T]: fc.Arbitrary<T[K]> } {
  const out = {} as { [K in keyof T]: fc.Arbitrary<T[K]> };
  for (const k of Object.keys(o) as (keyof T)[]) out[k] = fc.constant(o[k]);
  return out;
}

function runFor(c: EvCase): Recording {
  const layout = loadPreset(c.id);
  const faults: FaultEvent[] = c.freeze
    ? [{ kind: 'robot-freeze', tick: c.freeze.tick, robot: c.freeze.robot % c.robots, duration: null }]
    : [];
  return runHeadless(layout, { seed: c.seed, robots: c.robots, queueCap: layout.queueCap, faults }, c.ticks);
}

/** Copy of `rec` with every frame after d and every event after d overwritten with random values. */
function scrambleAfter(rec: Recording, d: number, cells: number, seed: number): Recording {
  const rng = mulberry32(seed);
  const n = rec.robots;
  const S = rec.stations;
  const out: Recording = {
    robots: n,
    stations: S,
    frames: rec.frames,
    positions: rec.positions.slice(),
    goals: rec.goals.slice(),
    states: rec.states.slice(),
    queueLen: rec.queueLen.slice(),
    evTick: rec.evTick.slice(),
    evRobot: rec.evRobot.slice(),
    evKind: rec.evKind.slice(),
    evArg: rec.evArg.slice(),
    events: rec.events,
  };
  for (let i = (d + 1) * n; i < rec.frames * n; i++) {
    out.positions[i] = randInt(rng, 0, cells - 1);
    out.goals[i] = randInt(rng, 0, cells - 1);
    out.states[i] = randInt(rng, 0, 4);
  }
  for (let i = (d + 1) * S; i < rec.frames * S; i++) out.queueLen[i] = randInt(rng, 0, 5);
  // Events after d keep ticks > d (non-decreasing) so "after d" stays well defined.
  let tick = d + 1;
  for (let e = 0; e < rec.events; e++) {
    if (rec.evTick[e] <= d) continue;
    tick += randInt(rng, 0, 3);
    out.evTick[e] = tick;
    out.evRobot[e] = randInt(rng, 0, n - 1);
    out.evKind[e] = randInt(rng, 0, 4);
    out.evArg[e] = randInt(rng, 0, Math.max(0, S - 1));
  }
  return out;
}

describe('extractEvidence properties', () => {
  // Feature: diagnosis, Property 1: Evidence is a deterministic, JSON-safe function of the prefix
  // **Validates: Requirements 1.1, 1.3**
  it('Property 1: Evidence is a deterministic, JSON-safe function of the prefix', () => {
    fc.assert(
      fc.property(evCaseArb, (c) => {
        const layout = loadPreset(c.id);
        const rec = runFor(c);
        const jam: Jam = { onsetTick: c.onset, detectedTick: c.d, severity: 0, signals: [] };
        const ev = extractEvidence(rec, layout, jam);
        expect(extractEvidence(rec, layout, jam)).toEqual(ev);
        const scrambled = scrambleAfter(rec, c.d, layout.width * layout.height, c.noise);
        expect(extractEvidence(scrambled, layout, jam)).toEqual(ev);
        expect(JSON.parse(JSON.stringify(ev))).toEqual(ev);
      }),
      { numRuns: 10 },
    );
  }, 120_000);

  // Feature: diagnosis, Property 2: Stalled robots are ordered and real
  // **Validates: Requirements 1.2**
  it('Property 2: Stalled robots are ordered and real', () => {
    let listed = 0;
    fc.assert(
      fc.property(evCaseArb, (c) => {
        const layout = loadPreset(c.id);
        const rec = runFor(c);
        const jam: Jam = { onsetTick: c.onset, detectedTick: c.d, severity: 0, signals: [] };
        const ev = extractEvidence(rec, layout, jam);
        const n = rec.robots;
        const d = c.d;

        expect(new Set(ev.stalled).size).toBe(ev.stalled.length);
        for (let i = 1; i < ev.stalled.length; i++) {
          const a = ev.stalled[i - 1];
          const b = ev.stalled[i];
          const sa = ev.standstillStart[a];
          const sb = ev.standstillStart[b];
          expect(sa < sb || (sa === sb && a < b)).toBe(true);
        }

        // Naive reference: scan back from d while the cell is unchanged and the state is not Idle.
        const expected: number[] = [];
        for (let r = 0; r < n; r++) {
          let t = d;
          while (t >= 1 && rec.positions[t * n + r] === rec.positions[(t - 1) * n + r] && rec.states[t * n + r] !== RState.Idle) t--;
          const len = d - t;
          const start = len > 0 ? t + 1 : -1;
          expect(ev.standstillStart[r]).toBe(start);
          const serving = rec.states[d * n + r] === RState.Serving;
          if (len >= (serving ? SERVE_STALL : STALL_MIN)) expected.push(r);
        }
        expect([...ev.stalled].sort((a, b) => a - b)).toEqual(expected);
        listed += ev.stalled.length;
      }),
      { numRuns: 10 },
    );
    console.log(`property 2: ${listed} stalled robots listed over 10 runs`);
  }, 120_000);
});
