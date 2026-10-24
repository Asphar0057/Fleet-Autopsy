import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/diagnosis/diagnose';
import { FIX_PASS, fixOutcome, proposeFix, verifyFix } from '../src/diagnosis/fix';
import type { Diagnosis, ObservedConfig } from '../src/diagnosis/types';
import { detectJam } from '../src/sim/jam';
import type { Layout } from '../src/sim/layout';
import { SCENARIOS, scenarioConfig } from '../src/sim/scenarios';
import type { Scenario } from '../src/sim/scenarios';
import { runHeadless } from '../src/sim/sim';
import type { FaultEvent, SimConfig } from '../src/sim/types';
import { PRESET_IDS, loadPreset, oneFaultArb } from './helpers';

interface Curated {
  s: Scenario;
  layout: Layout;
  world: SimConfig;
  diagnosis: Promise<Diagnosis>;
}

const cache = new Map<string, Curated>();

/** 2000-tick run, jam, and diagnosis (observed config only) of a curated scenario, memoized. */
function curated(id: string): Curated {
  let c = cache.get(id);
  if (!c) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario ${id}`);
    const layout = loadPreset(s.layoutId);
    const world = scenarioConfig(s, layout);
    const rec = runHeadless(layout, world, 2000);
    const jam = detectJam(rec, layout, 2000);
    if (!jam) throw new Error(`${id}: no jam`);
    const observed: ObservedConfig = { seed: world.seed, robots: world.robots, queueCap: world.queueCap };
    c = { s, layout, world, diagnosis: diagnose(layout, observed, rec, jam) };
    cache.set(id, c);
  }
  return c;
}

/** A copy of `d` whose root cause names `fault` instead. */
function withRootFault(d: Diagnosis, fault: FaultEvent): Diagnosis {
  if (d.rootCause === null) throw new Error('no root cause to replace');
  return { ...d, rootCause: { ...d.rootCause, fault } };
}

// ---- verified fix (required test 6) ----

describe('verifyFix on curated scenarios', () => {
  for (const s of SCENARIOS) {
    it(`${s.id}: the diagnosed fix passes in simulation`, async () => {
      const { layout, world, diagnosis } = curated(s.id);
      const d = await diagnosis;
      const r = verifyFix(layout, world, d);
      console.log(
        `${s.id}: recoveredFraction ${r.recoveredFraction.toFixed(3)} (baseline ${r.throughputBaseline.toFixed(2)}, before ${r.throughputBefore.toFixed(2)}, after ${r.throughputAfter.toFixed(2)}) fix: ${r.fix}`,
      );
      expect(r.verifiedBy).toBe('simulation');
      expect(r.fix).not.toBeNull();
      expect(r.removed.length).toBeGreaterThan(0);
      expect(r.recoveredFraction).toBeGreaterThanOrEqual(FIX_PASS);
      expect(r.passed).toBe(true);
    }, 180_000);
  }
});

describe('verifyFix rejects wrong fixes', () => {
  it('pd-decoy-first: blaming the decoy R6 fails', async () => {
    const { s, layout, world, diagnosis } = curated('pd-decoy-first');
    const decoy = s.faults.find((_f, i) => i !== s.groundTruth.primaryFaultIndex);
    if (!decoy || decoy.kind !== 'robot-freeze') throw new Error('expected a robot-freeze decoy');
    expect(decoy.robot).toBe(6);
    const r = verifyFix(layout, world, withRootFault(await diagnosis, decoy));
    console.log(`pd-decoy-first decoy fix: recoveredFraction ${r.recoveredFraction.toFixed(3)}`);
    expect(r.removed).toEqual([decoy]);
    expect(r.passed).toBe(false);
    expect(r.verifiedBy).toBe('simulation');
  }, 180_000);

  it('pd-holder-freeze: blaming an unrelated robot fails without a replay of a fixed world', async () => {
    const { layout, world, diagnosis } = curated('pd-holder-freeze');
    const d = await diagnosis;
    if (d.rootCause === null) throw new Error('no root cause');
    const used = new Set(world.faults.flatMap((f) => (f.kind === 'robot-freeze' || f.kind === 'slow-robot' ? [f.robot] : [])));
    let robot = 0;
    while (used.has(robot)) robot++;
    const wrong: FaultEvent = { kind: 'robot-freeze', tick: d.rootCause.fault.tick, robot, duration: null };
    const r = verifyFix(layout, world, withRootFault(d, wrong));
    expect(r.removed).toEqual([]);
    expect(r.throughputAfter).toBe(r.throughputBefore);
    expect(r.recoveredFraction).toBe(0);
    expect(r.passed).toBe(false);
    expect(r.fix).toBe(`take R${robot} out of service and clear it from the floor`);
  }, 180_000);

  it('a null root cause gives fix null and fails', async () => {
    const { layout, world, diagnosis } = curated('pd-holder-freeze');
    const r = verifyFix(layout, world, { ...(await diagnosis), rootCause: null });
    expect(r.fix).toBeNull();
    expect(r.removed).toEqual([]);
    expect(r.throughputAfter).toBe(r.throughputBefore);
    expect(r.passed).toBe(false);
    expect(r.verifiedBy).toBe('simulation');
  }, 180_000);
});

// ---- fix pass rule (Property 10) ----

/** Non-negative counts: integers, doubles, and small values that collide often. */
const countArb = fc.oneof(
  fc.integer({ min: 0, max: 400 }),
  fc.double({ min: 0, max: 400, noNaN: true }),
  fc.integer({ min: 0, max: 3 }),
);

describe('fixOutcome', () => {
  // Feature: diagnosis, Property 10: Fix pass rule
  // **Validates: Requirements 6.2**
  it('Property 10: recovered fraction is the clamped share of the gap; passed iff >= 0.7', () => {
    fc.assert(
      fc.property(countArb, countArb, countArb, fc.boolean(), (baseline, before, after, equal) => {
        // Half the time, force equal baseline and before.
        const b = equal ? baseline : before;
        const r = fixOutcome(baseline, b, after);
        const expected = baseline <= b ? 0 : Math.min(1, Math.max(0, (after - b) / (baseline - b)));
        expect(r.recoveredFraction).toBe(expected);
        expect(r.recoveredFraction).toBeGreaterThanOrEqual(0);
        expect(r.recoveredFraction).toBeLessThanOrEqual(1);
        expect(r.passed).toBe(r.recoveredFraction >= 0.7);
      }),
      { numRuns: 100 },
    );
  });

  it('examples: exact 0.7 passes, no gap gives 0', () => {
    expect(fixOutcome(110, 100, 107)).toEqual({ recoveredFraction: expect.closeTo(0.7, 12) as number, passed: true });
    expect(fixOutcome(200, 100, 170).passed).toBe(true);
    expect(fixOutcome(200, 100, 169).passed).toBe(false);
    expect(fixOutcome(100, 100, 150)).toEqual({ recoveredFraction: 0, passed: false });
    expect(fixOutcome(100, 50, 300).recoveredFraction).toBe(1);
    expect(fixOutcome(100, 50, 10).recoveredFraction).toBe(0);
  });
});

// ---- proposed fixes (Property 11) ----

/** The label a fix sentence must contain. */
function labelOf(f: FaultEvent): string {
  switch (f.kind) {
    case 'robot-freeze':
    case 'slow-robot':
      return `R${f.robot}`;
    case 'station-slowdown':
      return `S${String(f.station + 1).padStart(2, '0')}`;
    case 'blocked-cell':
      return `cell ${f.cell}`;
  }
}

/** `g` moved onto `f`'s kind and target, keeping `g`'s tick and duration and fresh parameters. */
function sameTargetOtherParams(f: FaultEvent, g: FaultEvent, param: number): FaultEvent {
  const { tick, duration } = g;
  switch (f.kind) {
    case 'robot-freeze':
      return { kind: f.kind, tick, robot: f.robot, duration };
    case 'slow-robot':
      return { kind: f.kind, tick, robot: f.robot, period: param, duration };
    case 'station-slowdown':
      return { kind: f.kind, tick, station: f.station, factor: param, duration };
    case 'blocked-cell':
      return { kind: f.kind, tick, cell: f.cell, duration };
  }
}

const proposeCaseArb = fc.constantFrom(...PRESET_IDS).chain((id) => {
  const layout = loadPreset(id);
  const faults = oneFaultArb(layout, layout.recommendedRobots);
  return fc.record({ id: fc.constant(id), f: faults, g: faults, param: fc.integer({ min: 2, max: 4 }) });
});

describe('proposeFix', () => {
  // Feature: diagnosis, Property 11: Proposed fixes name their target
  // **Validates: Requirements 6.3**
  it('Property 11: names the target, ignores tick and parameters, differs between kinds', () => {
    fc.assert(
      fc.property(proposeCaseArb, ({ id, f, g, param }) => {
        const layout = loadPreset(id);
        const text = proposeFix(f, layout);
        expect(text).toContain(labelOf(f));
        expect(proposeFix(sameTargetOtherParams(f, g, param), layout)).toBe(text);
        if (g.kind !== f.kind) expect(proposeFix(g, layout)).not.toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('sentences per kind', () => {
    const layout = loadPreset('pocket-dc');
    expect(proposeFix({ kind: 'robot-freeze', tick: 1, robot: 3, duration: null }, layout)).toBe(
      'take R3 out of service and clear it from the floor',
    );
    expect(proposeFix({ kind: 'station-slowdown', tick: 1, station: 1, factor: 3, duration: null }, layout)).toBe(
      'restore station S02 to its normal service time',
    );
    expect(proposeFix({ kind: 'slow-robot', tick: 1, robot: 5, period: 2, duration: null }, layout)).toBe(
      'take R5 out of service for a drive check',
    );
    const cell = layout.width * 2 + 3;
    expect(proposeFix({ kind: 'blocked-cell', tick: 1, cell, duration: null }, layout)).toBe(
      `clear the obstruction at cell ${cell} (3, 2)`,
    );
  });
});
