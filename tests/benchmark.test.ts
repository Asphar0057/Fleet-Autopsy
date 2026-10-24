import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BENCH_TICKS,
  KINDS,
  METHODS,
  TUNED_NAMES,
  VARIANTS,
  buildBenchmarkSet,
  formatAcc,
  median,
  renderResultsMd,
  runBenchmark,
} from '../src/diagnosis/benchmark';
import type { BenchmarkResult, CaseResult, MethodName } from '../src/diagnosis/benchmark';
import { ROUND_K } from '../src/diagnosis/diagnose';
import { SCENARIOS } from '../src/sim/scenarios';
import { PRESET_IDS, loadPreset } from './helpers';

const benchDir = fileURLToPath(new URL('../benchmark/', import.meta.url));
const FILES = ['results.json', 'RESULTS.md', 'dev-results.json'];

/** Existence and mtime of every benchmark output file. */
function fileState(): (number | null)[] {
  return FILES.map((f) => (existsSync(benchDir + f) ? statSync(benchDir + f).mtimeMs : null));
}

const layouts = PRESET_IDS.map((id) => loadPreset(id));
const before = { dir: existsSync(benchDir), files: fileState() };
let memo: Promise<BenchmarkResult> | null = null;

/** The fast-mode benchmark, run once per file. */
function fast(): Promise<BenchmarkResult> {
  memo ??= runBenchmark(layouts, buildBenchmarkSet(layouts, 'fast'), 'fast');
  return memo;
}

function acc(rows: readonly CaseResult[], m: MethodName) {
  const correct = rows.filter((r) => r[m].correct).length;
  return { correct, total: rows.length, accuracy: rows.length === 0 ? 0 : correct / rows.length };
}

describe('benchmark (fast mode, required test 8)', () => {
  it('builds two cases per curated scenario', () => {
    const cases = buildBenchmarkSet(layouts, 'fast');
    expect(cases.map((c) => c.id)).toEqual(SCENARIOS.flatMap((s) => [`${s.id}/world`, `${s.id}/primary-only`]));
    for (const c of cases) {
      const s = c.scenario;
      expect(c.primary).toEqual(s.faults[s.groundTruth.primaryFaultIndex]);
      expect(c.world.faults).toEqual(c.variant === 'world' ? s.faults : [s.faults[s.groundTruth.primaryFaultIndex]]);
    }
  });

  it('returns 12 case results with every field', async () => {
    const r = await fast();
    expect(r.mode).toBe('fast');
    expect(r.ticks).toBe(BENCH_TICKS);
    expect(r.scenarios).toBe(6);
    expect(r.cases).toBe(12);
    expect(r.results).toHaveLength(12);
    expect(Object.keys(r)).toEqual([
      'mode', 'ticks', 'scenarios', 'cases', 'notDetected', 'methods', 'medianReplays', 'medianMs', 'constants', 'results',
    ]);
    expect(Object.keys(r.constants)).toEqual(TUNED_NAMES);
    expect(r.constants.ROUND_K).toBe(ROUND_K);
    for (const c of r.results) {
      expect(Object.keys(c)).toEqual([
        'id', 'scenarioId', 'layoutId', 'seed', 'variant', 'primary', 'detectedTick', 'replaysRun', 'ms',
        'diagnose', 'firstAlarm', 'mostSevere',
      ]);
      const s = SCENARIOS.find((x) => x.id === c.scenarioId);
      expect(s).toBeDefined();
      expect(c.layoutId).toBe(s?.layoutId);
      expect(c.seed).toBe(s?.seed);
      // Curated scenarios are tested to detect.
      expect(c.detectedTick).not.toBeNull();
      expect(c.replaysRun).toBeGreaterThan(0);
      expect(typeof c.ms).toBe('number');
      for (const m of METHODS) {
        const o = c[m];
        expect(Object.keys(o)).toEqual(['target', 'correct', 'reason']);
        expect(o.reason === null).toBe(o.correct);
        if (o.reason === 'no-fault') expect(o.target).toBeNull();
        if (o.reason === 'wrong-kind') expect(o.target?.kind).not.toBe(c.primary.kind);
        if (o.reason === 'wrong-target') expect(o.target?.kind).toBe(c.primary.kind);
        if (o.reason === 'named-decoy') expect(c.variant).toBe('world');
        expect(o.reason).not.toBe('not-detected');
      }
    }
    // The diagnoser names the Primary on every curated case.
    expect(r.results.every((c) => c.diagnose.correct)).toBe(true);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  }, 300_000);

  it('accuracy by kind, variant, and overall; not-detected; medians', async () => {
    const r = await fast();
    expect(r.notDetected).toBe(r.results.filter((c) => c.detectedTick === null).length);
    for (const m of METHODS) {
      const s = r.methods[m];
      expect(Object.keys(s.byKind)).toEqual(KINDS);
      expect(Object.keys(s.byVariant)).toEqual(VARIANTS);
      expect(s.overall).toEqual(acc(r.results, m));
      for (const k of KINDS) expect(s.byKind[k]).toEqual(acc(r.results.filter((c) => c.primary.kind === k), m));
      for (const v of VARIANTS) expect(s.byVariant[v]).toEqual(acc(r.results.filter((c) => c.variant === v), m));
    }
    expect(r.methods.diagnose.overall).toEqual({ correct: 12, total: 12, accuracy: 1 });
    expect(r.methods.diagnose.byKind['robot-freeze'].total).toBe(10);
    expect(r.methods.diagnose.byKind['station-slowdown'].total).toBe(2);
    const detected = r.results.filter((c) => c.detectedTick !== null);
    expect(r.medianReplays).toBe(median(detected.map((c) => c.replaysRun ?? 0)));
    expect(r.medianMs).toBe(median(detected.map((c) => c.ms ?? 0)));
  }, 300_000);

  it('RESULTS.md contains the numbers, the honesty line, and the failures', async () => {
    const r = await fast();
    const md = renderResultsMd(r);
    expect(renderResultsMd(r)).toBe(md);
    expect(md).toContain('validated in simulation only');
    expect(md).toContain('only name robot-freeze or station-slowdown targets');
    expect(md).toContain('mode fast');
    expect(md).toContain('6 scenarios');
    expect(md).toContain('12 cases');
    expect(md).toContain(`not detected: ${r.notDetected} of 12 cases`);
    expect(md).toContain('### Among detected jams');
    expect(md).toContain('### Failure reasons');
    expect(md).toContain(`median replays per diagnosis: ${r.medianReplays}`);
    expect(md).toContain(`median ms per diagnosis: ${r.medianMs}`);
    for (const m of METHODS) {
      expect(md).toContain(formatAcc(r.methods[m].overall));
      for (const k of KINDS) expect(md).toContain(formatAcc(r.methods[m].byKind[k]));
    }
    const failed = r.results.filter((c) => METHODS.some((m) => !c[m].correct));
    for (const c of failed) {
      expect(md).toContain(`| ${c.id} |`);
      for (const m of METHODS) {
        const reason = c[m].reason;
        if (reason !== null) expect(md).toContain(reason);
      }
    }
  }, 300_000);

  it('writes no files', async () => {
    await fast();
    expect(existsSync(benchDir)).toBe(before.dir);
    expect(fileState()).toEqual(before.files);
  }, 300_000);
});

describe('median', () => {
  it('middle value, mean of the two middle values, 0 for none', () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
