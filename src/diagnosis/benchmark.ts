// Benchmark runner (Spec 3, Requirement 7): generated decoy-first scenarios on
// all three layouts, each run as the full world and as primary-only, scored for
// diagnose and both baselines against ground truth. This module reads the
// World_Config (design D1), so it sits outside the Diagnoser lint block; it
// passes only the Observed_Config to `diagnose`.
// Rules: design.md "Benchmark (task 8)", D2, D11.

import { detectJam } from '../sim/jam';
import type { Layout } from '../sim/layout';
import { generateScenarios } from '../sim/oracle';
import { SCENARIOS, scenarioConfig } from '../sim/scenarios';
import type { Scenario } from '../sim/scenarios';
import { runHeadless } from '../sim/sim';
import type { FaultEvent, FaultKind, SimConfig } from '../sim/types';
import { blameFirstAlarm, blameMostSevere, matchesGroundTruth, targetOf } from './baselines';
import { HIGH_GAP, HIGH_SCORE, MED_GAP, MED_SCORE, ROUND_K, diagnose } from './diagnose';
import {
  BLOCK_ENTRIES,
  BLOCK_GAP,
  BLOCK_LOOKBACK,
  HOTSPOTS,
  MOVE_WINDOW,
  SERVE_STALL,
  STALL_MIN,
  extractEvidence,
} from './evidence';
import {
  EARLY_MIN,
  EARLY_SERVICES,
  K_BLOCK,
  K_EPISODE,
  K_FREEZE,
  SLOW_MIN_MOVES,
  SLOW_RATIO_MIN,
} from './hypotheses';
import { POST_WEIGHT, W_POS, W_QUEUE, W_TP } from './score';
import type { ObservedConfig, Target } from './types';

/** Ticks of every benchmark run (same as ORACLE_TICKS and FIX_TICKS). */
export const BENCH_TICKS = 2000;
/** Generated scenarios per layout in full mode. */
export const PER_LAYOUT = 20;
/** First benchmark seed (disjoint from dev seeds, design D11). */
export const SEED_FROM = 1000;
/** Seeds below this are tried in full mode (exclusive). */
export const SEED_LIMIT = 1200;
/** Dev (tuning) seeds, inclusive (design D11). */
export const DEV_SEED_FROM = 100;
export const DEV_SEED_TO = 120;

export type BenchMode = 'full' | 'dev' | 'fast';
export type Variant = 'world' | 'primary-only';
export type MethodName = 'diagnose' | 'firstAlarm' | 'mostSevere';
export type ReasonCode = 'not-detected' | 'no-fault' | 'named-decoy' | 'wrong-kind' | 'wrong-target';

/** Fixed key lists; result maps are built from these, never from object iteration. */
export const METHODS: readonly MethodName[] = ['diagnose', 'firstAlarm', 'mostSevere'];
export const KINDS: readonly FaultKind[] = ['robot-freeze', 'station-slowdown', 'blocked-cell', 'slow-robot'];
export const VARIANTS: readonly Variant[] = ['world', 'primary-only'];

export interface BenchmarkCase {
  id: string;
  scenario: Scenario;
  variant: Variant;
  world: SimConfig;
  primary: FaultEvent;
}

export interface Acc {
  correct: number;
  total: number;
  accuracy: number;
}

export interface MethodOutcome {
  target: Target | null;
  correct: boolean;
  reason: ReasonCode | null;
}

export interface CaseResult {
  id: string;
  scenarioId: string;
  layoutId: string;
  seed: number;
  variant: Variant;
  primary: FaultEvent;
  detectedTick: number | null;
  replaysRun: number | null;
  ms: number | null;
  diagnose: MethodOutcome;
  firstAlarm: MethodOutcome;
  mostSevere: MethodOutcome;
}

export interface MethodSummary {
  overall: Acc;
  byKind: Record<FaultKind, Acc>;
  byVariant: Record<Variant, Acc>;
}

export interface BenchmarkResult {
  mode: BenchMode;
  ticks: number;
  scenarios: number;
  cases: number;
  notDetected: number;
  methods: Record<MethodName, MethodSummary>;
  medianReplays: number;
  medianMs: number;
  constants: Record<string, number>;
  results: CaseResult[];
}

/** The tunable constants (design "Tuned constants"), in table order, read from their modules. */
const TUNED: readonly (readonly [string, number])[] = [
  ['STALL_MIN', STALL_MIN],
  ['SERVE_STALL', SERVE_STALL],
  ['HOTSPOTS', HOTSPOTS],
  ['MOVE_WINDOW', MOVE_WINDOW],
  ['BLOCK_GAP', BLOCK_GAP],
  ['BLOCK_ENTRIES', BLOCK_ENTRIES],
  ['BLOCK_LOOKBACK', BLOCK_LOOKBACK],
  ['K_FREEZE', K_FREEZE],
  ['K_EPISODE', K_EPISODE],
  ['K_BLOCK', K_BLOCK],
  ['EARLY_SERVICES', EARLY_SERVICES],
  ['EARLY_MIN', EARLY_MIN],
  ['SLOW_RATIO_MIN', SLOW_RATIO_MIN],
  ['SLOW_MIN_MOVES', SLOW_MIN_MOVES],
  ['POST_WEIGHT', POST_WEIGHT],
  ['W_POS', W_POS],
  ['W_TP', W_TP],
  ['W_QUEUE', W_QUEUE],
  ['ROUND_K', ROUND_K],
  ['HIGH_SCORE', HIGH_SCORE],
  ['HIGH_GAP', HIGH_GAP],
  ['MED_SCORE', MED_SCORE],
  ['MED_GAP', MED_GAP],
];

/** Names of the tuned constants, in table order. */
export const TUNED_NAMES: readonly string[] = TUNED.map(([k]) => k);

/** The tuned constants as a map built from the fixed list. */
export function tunedConstants(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of TUNED) out[k] = v;
  return out;
}

// ---- case set ----

function layoutFor(layouts: readonly Layout[], id: string): Layout {
  const l = layouts.find((x) => x.id === id);
  if (!l) throw new Error(`benchmark: no layout ${id}`);
  return l;
}

/** One generated scenario per seed in [from, to], skipping seeds that throw, at most `max`. */
function generated(layout: Layout, from: number, to: number, max: number): Scenario[] {
  const out: Scenario[] = [];
  for (let seed = from; seed <= to && out.length < max; seed++) {
    try {
      out.push(generateScenarios(layout, seed, 1)[0]);
    } catch {
      // no valid scenario for this seed; skipped (design "Error Handling")
    }
  }
  return out;
}

/** The world case and the primary-only case of a scenario. */
function casesOf(s: Scenario, layout: Layout): BenchmarkCase[] {
  const world = scenarioConfig(s, layout);
  const primary = { ...world.faults[s.groundTruth.primaryFaultIndex] };
  return [
    { id: `${s.id}/world`, scenario: s, variant: 'world', world, primary },
    {
      id: `${s.id}/primary-only`,
      scenario: s,
      variant: 'primary-only',
      world: { ...world, faults: [{ ...primary }] },
      primary,
    },
  ];
}

/**
 * Benchmark cases. `full`: per layout in the given (manifest) order, seeds
 * SEED_FROM.. below SEED_LIMIT, up to PER_LAYOUT scenarios. `dev`: seeds 100 to
 * 120 inclusive, every seed that yields a scenario. `fast`: the 6 curated
 * scenarios. Each scenario yields a `world` and a `primary-only` case.
 */
export function buildBenchmarkSet(layouts: readonly Layout[], mode: BenchMode): BenchmarkCase[] {
  const scenarios: Scenario[] = [];
  if (mode === 'fast') {
    scenarios.push(...SCENARIOS);
  } else {
    for (const layout of layouts) {
      if (mode === 'full') scenarios.push(...generated(layout, SEED_FROM, SEED_LIMIT - 1, PER_LAYOUT));
      else scenarios.push(...generated(layout, DEV_SEED_FROM, DEV_SEED_TO, Number.POSITIVE_INFINITY));
    }
  }
  return scenarios.flatMap((s) => casesOf(s, layoutFor(layouts, s.layoutId)));
}

// ---- running ----

/** Faults of the case that are decoys: the scenario's decoys in the world variant, none in primary-only. */
function decoysOf(c: BenchmarkCase): FaultEvent[] {
  if (c.variant === 'primary-only') return [];
  return c.scenario.groundTruth.decoyIndices.map((i) => c.world.faults[i]);
}

/** Outcome of one method; the reason is the first code that applies. */
function outcome(target: Target | null, c: BenchmarkCase, layout: Layout): MethodOutcome {
  if (matchesGroundTruth(target, c.primary, layout)) return { target, correct: true, reason: null };
  let reason: ReasonCode;
  if (target === null) reason = 'no-fault';
  else if (decoysOf(c).some((f) => matchesGroundTruth(target, f, layout))) reason = 'named-decoy';
  else if (target.kind !== c.primary.kind) reason = 'wrong-kind';
  else reason = 'wrong-target';
  return { target, correct: false, reason };
}

const NOT_DETECTED: MethodOutcome = { target: null, correct: false, reason: 'not-detected' };

/** Middle value; mean of the two middle values for an even count; 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function acc(rows: readonly CaseResult[], method: MethodName): Acc {
  const total = rows.length;
  const correct = rows.filter((r) => r[method].correct).length;
  return { correct, total, accuracy: total === 0 ? 0 : correct / total };
}

function summarize(results: readonly CaseResult[], method: MethodName): MethodSummary {
  const byKind = {} as Record<FaultKind, Acc>;
  for (const k of KINDS) byKind[k] = acc(results.filter((r) => r.primary.kind === k), method);
  const byVariant = {} as Record<Variant, Acc>;
  for (const v of VARIANTS) byVariant[v] = acc(results.filter((r) => r.variant === v), method);
  return { overall: acc(results, method), byKind, byVariant };
}

/**
 * Runs every case in order: BENCH_TICKS-tick world run, detectJam, then
 * diagnose (Observed_Config only) and both baselines, each judged by
 * matchesGroundTruth against the Primary. No detection fails every method.
 */
export async function runBenchmark(
  layouts: readonly Layout[],
  cases: readonly BenchmarkCase[],
  mode: BenchMode,
): Promise<BenchmarkResult> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const layout = layoutFor(layouts, c.scenario.layoutId);
    const rec = runHeadless(layout, c.world, BENCH_TICKS);
    const jam = detectJam(rec, layout, BENCH_TICKS);
    const head = {
      id: c.id,
      scenarioId: c.scenario.id,
      layoutId: c.scenario.layoutId,
      seed: c.scenario.seed,
      variant: c.variant,
      primary: c.primary,
    };
    if (jam === null) {
      results.push({
        ...head,
        detectedTick: null,
        replaysRun: null,
        ms: null,
        diagnose: NOT_DETECTED,
        firstAlarm: NOT_DETECTED,
        mostSevere: NOT_DETECTED,
      });
      continue;
    }
    const observed: ObservedConfig = { seed: c.world.seed, robots: c.world.robots, queueCap: c.world.queueCap };
    const ev = extractEvidence(rec, layout, jam);
    const d = await diagnose(layout, observed, rec, jam);
    results.push({
      ...head,
      detectedTick: jam.detectedTick,
      replaysRun: d.replaysRun,
      ms: d.elapsedMs,
      diagnose: outcome(d.rootCause === null ? null : targetOf(d.rootCause.fault), c, layout),
      firstAlarm: outcome(blameFirstAlarm(ev), c, layout),
      mostSevere: outcome(blameMostSevere(ev), c, layout),
    });
  }

  const detected = results.filter((r) => r.detectedTick !== null);
  const methods = {} as Record<MethodName, MethodSummary>;
  for (const m of METHODS) methods[m] = summarize(results, m);
  const scenarioIds: string[] = [];
  for (const c of cases) if (!scenarioIds.includes(c.scenario.id)) scenarioIds.push(c.scenario.id);

  return {
    mode,
    ticks: BENCH_TICKS,
    scenarios: scenarioIds.length,
    cases: results.length,
    notDetected: results.length - detected.length,
    methods,
    medianReplays: median(detected.map((r) => r.replaysRun ?? 0)),
    medianMs: median(detected.map((r) => r.ms ?? 0)),
    constants: tunedConstants(),
    results,
  };
}

// ---- RESULTS.md ----

const METHOD_LABEL: Record<MethodName, string> = {
  diagnose: 'diagnose (replay)',
  firstAlarm: 'first alarm',
  mostSevere: 'most severe',
};

/** `correct / total (pct%)`, one decimal. */
export function formatAcc(a: Acc): string {
  return `${a.correct} / ${a.total} (${(a.accuracy * 100).toFixed(1)}%)`;
}

/** Short label of a fault or target: `robot-freeze R3`, `station-slowdown S02`, `blocked-cell cell 312`. */
function targetLabel(t: Target | null): string {
  if (t === null) return 'none';
  if (t.robot !== undefined) return `${t.kind} R${t.robot}`;
  if (t.station !== undefined) return `${t.kind} S${String(t.station + 1).padStart(2, '0')}`;
  if (t.cell !== undefined) return `${t.kind} cell ${t.cell}`;
  return t.kind;
}

function faultLabel(f: FaultEvent): string {
  const dur = f.duration === null ? '' : ` for ${f.duration}`;
  return `${targetLabel(targetOf(f))} @${f.tick}${dur}`;
}

function outcomeLabel(o: MethodOutcome): string {
  return o.correct ? 'ok' : `${targetLabel(o.target)} · ${o.reason ?? ''}`;
}

/** Markdown report of a benchmark result. Pure: no timestamps, no clock. */
export function renderResultsMd(r: BenchmarkResult): string {
  const lines: string[] = [];
  const row = (cells: readonly string[]): void => {
    lines.push(`| ${cells.join(' | ')} |`);
  };
  lines.push('# Diagnosis benchmark');
  lines.push('');
  lines.push('validated in simulation only. not validated on real fleets.');
  lines.push('');
  lines.push(
    `mode ${r.mode} · ${r.ticks} ticks per run · ${r.scenarios} scenarios · ${r.cases} cases (world and primary-only per scenario)`,
  );
  lines.push('');
  lines.push('## Accuracy');
  lines.push('');
  lines.push('A method is correct when its target matches the primary fault (`matchesGroundTruth`). Cases without a jam detection count as wrong for every method.');
  lines.push('');
  const cols = ['overall', ...KINDS, ...VARIANTS];
  row(['method', ...cols]);
  row(['---', ...cols.map(() => '---')]);
  for (const m of METHODS) {
    const s = r.methods[m];
    row([
      METHOD_LABEL[m],
      formatAcc(s.overall),
      ...KINDS.map((k) => formatAcc(s.byKind[k])),
      ...VARIANTS.map((v) => formatAcc(s.byVariant[v])),
    ]);
  }
  lines.push('');
  lines.push(`- not detected: ${r.notDetected} of ${r.cases} cases`);
  lines.push(`- median replays per diagnosis: ${r.medianReplays}`);
  lines.push(`- median ms per diagnosis: ${r.medianMs}`);
  lines.push('- the baselines only name robot-freeze or station-slowdown targets, so they cannot be correct on blocked-cell or slow-robot primaries.');
  lines.push('');
  lines.push('## Failures');
  lines.push('');
  const failed = r.results.filter((x) => !x.diagnose.correct || !x.firstAlarm.correct || !x.mostSevere.correct);
  if (failed.length === 0) {
    lines.push('no failures');
  } else {
    row(['case', 'primary', ...METHODS.map((m) => METHOD_LABEL[m])]);
    row(['---', '---', ...METHODS.map(() => '---')]);
    for (const x of failed) {
      row([x.id, faultLabel(x.primary), ...METHODS.map((m) => outcomeLabel(x[m]))]);
    }
  }
  lines.push('');
  lines.push('## Constants');
  lines.push('');
  lines.push('tuned on dev seeds 100 to 120 only; benchmark seeds start at 1000.');
  lines.push('');
  row(['constant', 'value']);
  row(['---', '---']);
  for (const k of TUNED_NAMES) if (k in r.constants) row([k, String(r.constants[k])]);
  lines.push('');
  return lines.join('\n');
}
