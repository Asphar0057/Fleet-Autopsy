// Deterministic template report, built only from the autopsy data (no model, no clock).
import { evidenceLines, faultLabel, fixThroughputLine, fixWindow, impactWindow } from './model';
import type { AutopsyData } from './types';

/** Section titles; the UI renders these lines as headings, the copied text keeps them plain. */
export const REPORT_SECTIONS: readonly string[] = [
  'Summary',
  'Timeline',
  'Root cause',
  'Impact',
  'Recommended fix',
  'Confidence and limits',
];

export function templateReport(a: AutopsyData): string {
  const d = a.diagnosis;
  const rc = d.rootCause;
  const f = a.fix;
  const L: string[] = [];
  L.push('Summary');
  L.push(
    rc
      ? `A jam was detected at tick ${a.jam.detectedTick}. The most likely root cause is ${faultLabel(rc.fault)}.`
      : `A jam was detected at tick ${a.jam.detectedTick}. No single root cause explained it.`,
  );
  L.push('');
  L.push('Timeline');
  if (rc) L.push(`- tick ${rc.fault.tick}: ${faultLabel(rc.fault)} (diagnosed start)`);
  L.push(`- tick ${a.jam.onsetTick}: throughput starts to fall (onset)`);
  L.push(`- tick ${a.jam.detectedTick}: jam detected, throughput down ${Math.round(a.jam.severity * 100)}%`);
  L.push(`- ${d.replaysRun} alternate timelines replayed up to tick ${d.window.endTick}`);
  L.push('');
  L.push('Root cause');
  if (rc) {
    L.push(faultLabel(rc.fault));
    for (const e of evidenceLines(a)) L.push(`- ${e}`);
  } else {
    L.push('none found');
  }
  L.push('');
  L.push('Impact');
  if (rc) L.push(`Diagnosis: removal recovers ${rc.impact.toFixed(1)} deliveries / 100 ticks ${impactWindow(a)}.`);
  L.push(
    `Observed: ${f.throughputBefore.toFixed(2)} deliveries / 100 ticks with the fault, ` +
      `${f.throughputBaseline.toFixed(2)} without any fault, ${fixWindow(a)}.`,
  );
  L.push('');
  L.push('Recommended fix');
  L.push(f.fix ?? 'none');
  L.push(
    f.passed
      ? `Verified in simulation: ${fixThroughputLine(a)}, recovered fraction ${f.recoveredFraction.toFixed(2)}.`
      : `Not verified: ${fixThroughputLine(a)}, recovered fraction ${f.recoveredFraction.toFixed(2)}.`,
  );
  L.push('');
  L.push('Confidence and limits');
  L.push(`Confidence: ${rc ? rc.confidence : 'none'}.`);
  L.push('Validated in simulation only, against injected faults with known ground truth. Not validated on real fleets.');
  L.push('Thresholds are fixed; mild faults can fall below the detector and go unseen.');
  return L.join('\n') + '\n';
}
