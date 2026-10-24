// Pure view model of the autopsy stage: step copy, suspects, baselines. Every
// string is built from the autopsy data, not hard-coded per scenario.
import { blameFirstAlarm, blameMostSevere, matchesGroundTruth, targetOf } from '../../diagnosis/baselines';
import type { Target } from '../../diagnosis/types';
import type { Layout } from '../../sim/layout';
import type { FaultEvent, Scenario } from '../../sim/types';
import { stationLabel } from '../../render/labels';
import type { AutopsyData } from './types';

export const STEP_TITLES = ['The alarm', 'Suspects', 'Counterfactual replay', 'Root cause', 'Verified fix'] as const;

/** Short label of a target: `R3`, `station S02`, `cell 135`. */
export function targetLabel(t: Target | null): string {
  if (t === null) return 'no pick';
  if (t.robot !== undefined) return t.kind === 'slow-robot' ? `slow R${t.robot}` : `frozen R${t.robot}`;
  if (t.station !== undefined) return `slow station S${stationLabel(t.station)}`;
  if (t.cell !== undefined) return `blocked cell ${t.cell}`;
  return t.kind;
}

/** `frozen R3 from tick 547`. */
export function faultLabel(f: FaultEvent): string {
  return `${targetLabel(targetOf(f))} from tick ${f.tick}`;
}

/** Title and one-line caption of a step, from the data. */
export function stepCopy(a: AutopsyData, step: number): { title: string; caption: string } {
  const d = a.diagnosis;
  const rc = d.rootCause;
  const title = STEP_TITLES[Math.min(5, Math.max(1, step)) - 1];
  switch (step) {
    case 1:
      return {
        title,
        caption: `Throughput fell after tick ${a.jam.onsetTick}; the detector fired at tick ${a.jam.detectedTick}.`,
      };
    case 2:
      return {
        title,
        caption: `${d.hypotheses.length} candidate faults from the evidence, scored by ${d.replaysRun} replays.`,
      };
    case 3:
      return {
        title,
        caption: rc
          ? `The observed run beside a replay with only ${faultLabel(rc.fault)} injected.`
          : 'No hypothesis explained the jam, so there is no replay to compare.',
      };
    case 4:
      return {
        title,
        caption: rc ? `${faultLabel(rc.fault)} · confidence ${rc.confidence}.` : 'No root cause was found.',
      };
    default:
      return {
        title,
        caption: a.fix.passed
          ? `Removing it recovers ${(a.fix.recoveredFraction * 100).toFixed(0)}% of the lost throughput.`
          : 'The proposed fix did not pass in simulation.',
      };
  }
}

export interface Suspect {
  label: string;
  /** Replay match in [0, 1]; null when not replayed. */
  score: number | null;
  lead: boolean;
}

/** Candidate faults, leading hypothesis first, then by score (unscored last), at most `max`. */
export function suspects(a: AutopsyData, max = 8): Suspect[] {
  const rc = a.diagnosis.rootCause;
  const same = (f: FaultEvent) => rc !== null && JSON.stringify(f) === JSON.stringify(rc.fault);
  const rows = a.diagnosis.hypotheses.map((h, i) => ({ h, i, lead: same(h.fault) }));
  rows.sort((x, y) => {
    if (x.lead !== y.lead) return x.lead ? -1 : 1;
    const sx = x.h.score ?? -1;
    const sy = y.h.score ?? -1;
    return sx !== sy ? sy - sx : x.i - y.i;
  });
  return rows.slice(0, max).map((r) => ({ label: faultLabel(r.h.fault), score: r.h.score, lead: r.lead }));
}

/** World faults without the diagnosed root cause (what "Replay with fix applied" runs). */
export function faultsWithoutCause(a: AutopsyData, faults: readonly FaultEvent[], layout: Layout): FaultEvent[] {
  const rc = a.diagnosis.rootCause;
  if (rc === null) return faults.map((f) => ({ ...f }));
  const t = targetOf(rc.fault);
  return faults.filter((f) => !matchesGroundTruth(t, f, layout)).map((f) => ({ ...f }));
}

export interface BaselineRow {
  method: 'Fleet Autopsy' | 'Blame the first alarm' | 'Blame the most severe';
  pick: string;
  /** Against ground truth; null without ground truth or before step 4. */
  correct: boolean | null;
}

/** The three methods with their pick and, once `reveal`, a mark against the scenario's primary fault. */
export function baselineRows(
  a: AutopsyData,
  layout: Layout,
  scenario: Scenario | null,
  reveal: boolean,
): BaselineRow[] {
  const rc = a.diagnosis.rootCause;
  const ev = a.diagnosis.evidence;
  const primary = scenario ? scenario.faults[scenario.groundTruth.primaryFaultIndex] : null;
  const picks: [BaselineRow['method'], Target | null][] = [
    ['Fleet Autopsy', rc ? targetOf(rc.fault) : null],
    ['Blame the first alarm', blameFirstAlarm(ev)],
    ['Blame the most severe', blameMostSevere(ev)],
  ];
  return picks.map(([method, t]) => ({
    method,
    pick: targetLabel(t),
    correct: reveal && primary ? matchesGroundTruth(t, primary, layout) : null,
  }));
}

/** Tick the "Play" button of a step starts playback from. */
export function focusTick(a: AutopsyData, step: number): number {
  const rc = a.diagnosis.rootCause;
  const before = (t: number) => Math.max(0, t - 40);
  if (step === 1) return before(a.jam.onsetTick);
  if (step === 4) return before(a.jam.detectedTick);
  return before(rc ? rc.fault.tick : a.jam.onsetTick);
}
