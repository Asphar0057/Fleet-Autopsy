import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeRecovered, deliveries, isValid, scoreFaults } from '../src/sim/oracle';
import type { OracleResult } from '../src/sim/oracle';
import type { Layout } from '../src/sim/layout';
import type { Recording } from '../src/sim/recorder';
import { SCENARIOS, scenarioConfig } from '../src/sim/scenarios';
import type { Scenario } from '../src/sim/scenarios';
import { runHeadless } from '../src/sim/sim';
import { verifyRun } from '../src/sim/verify';
import { CellKind, EKind, RState } from '../src/sim/types';
import type { FaultEvent, GroundTruth, SimConfig } from '../src/sim/types';
import { loadPreset, PRESET_IDS } from './helpers';

describe('scoreFaults', () => {
  it('a single-fault config recovers exactly 1 (the removed run is the baseline)', () => {
    const layout = loadPreset('pocket-dc');
    const fault: FaultEvent = { kind: 'station-slowdown', tick: 50, station: 0, factor: 4, duration: null };
    const config: SimConfig = { seed: 1, robots: layout.recommendedRobots, queueCap: layout.queueCap, faults: [fault] };
    const r = scoreFaults(layout, config);
    expect(r.baseline).toBe(deliveries(runHeadless(layout, { ...config, faults: [] }, 2000)));
    expect(r.baseline).toBeGreaterThan(r.withAll);
    expect(r.without[0]).toBe(r.baseline);
    expect(r.recovered[0]).toBe(1);
  });

  it('gives every fraction 0 when the faults cost nothing', () => {
    expect(computeRecovered(10, 10, [12, 9])).toEqual([0, 0]);
    expect(computeRecovered(10, 12, [10])).toEqual([0]);
  });
});

/** Baseline, with-all, without-counts, and a ground truth over those faults. */
const caseArb = fc
  .record({
    baseline: fc.integer({ min: 0, max: 60 }),
    withAll: fc.integer({ min: 0, max: 60 }),
    without: fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 1, maxLength: 4 }),
  })
  .chain((c) =>
    fc.integer({ min: 0, max: c.without.length - 1 }).chain((p) => {
      const others = [...c.without.keys()].filter((i) => i !== p);
      return fc.record({
        c: fc.constant(c),
        gt: fc.record({
          primaryFaultIndex: fc.constant(p),
          decoyIndices: others.length > 0 ? fc.subarray(others) : fc.constant<number[]>([]),
        }),
      });
    }),
  );

/** Independent reference: integer cross-multiplication, no division. */
function referenceValid(b: number, w: number, without: number[], gt: GroundTruth): boolean {
  const gap = b - w;
  if (gap <= 0 || 10 * gap < b) return false;
  if (10 * (without[gt.primaryFaultIndex] - w) < 7 * gap) return false;
  return gt.decoyIndices.every((d) => 10 * (without[d] - w) < gap);
}

describe('oracle validity property', () => {
  // Feature: failures-telemetry, Property 11: Validity rule matches its formula
  // **Validates: Requirements 6.2**
  it('Property 11: Validity rule matches its formula', () => {
    fc.assert(
      fc.property(caseArb, ({ c, gt }) => {
        const r: OracleResult = { ...c, recovered: computeRecovered(c.baseline, c.withAll, c.without) };
        return isValid(r, gt) === referenceValid(c.baseline, c.withAll, c.without, gt);
      }),
      { numRuns: 100 },
    );
  });
});

// ---- curated scenarios (Requirements 2.3, 5.1 to 5.3, 6.2; design.md D23, D24) ----

const cellAt = (rec: Recording, t: number, r: number) => rec.positions[t * rec.robots + r];
const stateAt = (rec: Recording, t: number, r: number) => rec.states[t * rec.robots + r];

/** One-cell aisle between pod blocks: floor at x in {12, 19, 26} with pods left and right. */
function inFbAisle(l: Layout, c: number): boolean {
  const x = c % l.width;
  return (
    (x === 12 || x === 19 || x === 26) &&
    l.kinds[c] === CellKind.Floor &&
    l.kinds[c - 1] === CellKind.Pod &&
    l.kinds[c + 1] === CellKind.Pod
  );
}

/** Door: floor in the wall column x = 17 with wall above and below. */
function isCpDoor(l: Layout, c: number): boolean {
  return (
    c % l.width === 17 &&
    l.kinds[c] === CellKind.Floor &&
    l.kinds[c - l.width] === CellKind.Wall &&
    l.kinds[c + l.width] === CellKind.Wall
  );
}

/** Station with the most service starts in ticks 1 to before − 1 (lowest index on ties). */
function busiestStation(rec: Recording, l: Layout, before: number): number {
  const n = new Array<number>(l.stations.length).fill(0);
  for (let e = 0; e < rec.events; e++) {
    if (rec.evKind[e] === EKind.ServiceStart && rec.evTick[e] >= 1 && rec.evTick[e] < before) n[rec.evArg[e]]++;
  }
  return n.indexOf(Math.max(...n));
}

function servingOnStation(rec: Recording, l: Layout, t: number, r: number): boolean {
  return stateAt(rec, t, r) === RState.Serving && l.stationAt[cellAt(rec, t, r)] >= 0;
}

/** Placement predicate per curated fault, checked on the fault-free run. */
function placementOk(s: Scenario, k: number, l: Layout, rec: Recording): boolean {
  const f = s.faults[k];
  const t = f.tick - 1;
  const robotCell = 'robot' in f ? cellAt(rec, t, f.robot) : -1;
  switch (s.id) {
    case 'fb-aisle-freeze':
      return f.kind === 'robot-freeze' && inFbAisle(l, robotCell);
    case 'fb-station-slow':
      return f.kind === 'station-slowdown' && f.factor === 4 && f.station === busiestStation(rec, l, f.tick);
    case 'cp-door-freeze':
    case 'cp-lower-door-freeze':
      return f.kind === 'robot-freeze' && isCpDoor(l, robotCell);
    case 'pd-holder-freeze':
      return f.kind === 'robot-freeze' && servingOnStation(rec, l, t, f.robot);
    case 'pd-decoy-first': {
      if (f.kind !== 'robot-freeze') return false;
      if (k === s.groundTruth.primaryFaultIndex) return servingOnStation(rec, l, t, f.robot);
      const y = Math.floor(robotCell / l.width);
      return (y === 2 || y === 8) && l.kinds[robotCell] === CellKind.Floor && l.accessOf[robotCell] < 0;
    }
    default:
      return false;
  }
}

describe('curated scenarios', () => {
  it('has at least 6 scenarios, at least 2 per layout, unique ids, decoys before the primary', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const id of PRESET_IDS) {
      expect(SCENARIOS.filter((s) => s.layoutId === id).length).toBeGreaterThanOrEqual(2);
    }
    const withDecoy = SCENARIOS.filter((s) => s.groundTruth.decoyIndices.length > 0);
    expect(withDecoy.length).toBeGreaterThanOrEqual(1);
    for (const s of withDecoy) {
      const p = s.faults[s.groundTruth.primaryFaultIndex].tick;
      for (const d of s.groundTruth.decoyIndices) expect(s.faults[d].tick).toBeLessThan(p);
    }
  });

  it('scenarioConfig takes the queue cap from the layout and copies the faults', () => {
    const s = SCENARIOS[0];
    const l = loadPreset(s.layoutId);
    const c = scenarioConfig(s, l);
    expect(c).toEqual({ seed: s.seed, robots: s.robots, queueCap: l.queueCap, faults: s.faults });
    expect(c.faults).not.toBe(s.faults);
    expect(() => scenarioConfig(s, loadPreset(PRESET_IDS.find((id) => id !== s.layoutId)!))).toThrow();
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))(
    '%s: placement holds, oracle confirms the ground truth, verifier clean over 2,000 ticks',
    (_id, s) => {
      const l = loadPreset(s.layoutId);
      const config = scenarioConfig(s, l);
      expect(s.robots).toBeLessThanOrEqual(l.maxRobots);
      const free = runHeadless(l, { ...config, faults: [] }, 2000);
      for (let k = 0; k < s.faults.length; k++) expect(placementOk(s, k, l, free), `fault ${k}`).toBe(true);

      const r = scoreFaults(l, config);
      console.log(
        `${s.id}: deliveries ${r.baseline} -> ${r.withAll} ` +
          `(loss ${((1 - r.withAll / r.baseline) * 100).toFixed(1)}%), recovered ${r.recovered.map((x) => x.toFixed(3)).join(', ')}`,
      );
      expect(isValid(r, s.groundTruth)).toBe(true);

      const rec = runHeadless(l, config, 2000);
      expect(verifyRun(rec, l, config.faults)).toEqual([]);
    },
    120_000,
  );
});
