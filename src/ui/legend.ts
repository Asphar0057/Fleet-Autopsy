// Ground-truth reveal helpers (Spec 2, Requirement 8.4, design.md D21). Pure, no DOM.
// Tags are `F{index + 1}`; robots are `R{id}` (as in the stall label), stations use
// the two-digit station label drawn on the canvas (`S02` is station index 1).

import type { RevealMark } from '../render/marks';
import { stationLabel } from '../render/labels';
import type { FaultEvent, GroundTruth } from '../sim/types';

/** Tag for fault index `k`: `F1`, `F2`, ... */
export function faultTag(k: number): string {
  return `F${k + 1}`;
}

/** Short lowercase description of what a fault does to which target. */
function faultWhat(f: FaultEvent, width: number): string {
  switch (f.kind) {
    case 'robot-freeze':
      return `freeze R${f.robot}`;
    case 'slow-robot':
      return `slow R${f.robot} period ${f.period}`;
    case 'station-slowdown':
      return `slowdown S${stationLabel(f.station)} ×${f.factor}`;
    case 'blocked-cell':
      return `block (${f.cell % width},${Math.floor(f.cell / width)})`;
  }
}

/**
 * One-line legend, e.g.
 * `ground truth · F1 freeze R6 t=350 30t (decoy) · F2 freeze R3 t=550 permanent (primary)`.
 * `width` is the layout width, used for blocked-cell coordinates `(x,y)`.
 */
export function faultLegend(faults: readonly FaultEvent[], groundTruth: GroundTruth | null, width: number): string {
  if (faults.length === 0) return 'ground truth · no faults';
  const parts = faults.map((f, k) => {
    const dur = f.duration === null ? 'permanent' : `${f.duration}t`;
    let role = '';
    if (groundTruth?.primaryFaultIndex === k) role = ' (primary)';
    else if (groundTruth?.decoyIndices.includes(k)) role = ' (decoy)';
    return `${faultTag(k)} ${faultWhat(f, width)} t=${f.tick} ${dur}${role}`;
  });
  return `ground truth · ${parts.join(' · ')}`;
}

/**
 * Markers for faults whose tick is at or before `tick` (a fault not yet started
 * has no marker). Several faults on the same target share one marker with
 * joined tags (`F1 F2`). Order: by fault index of the first fault on the target.
 */
export function revealMarks(faults: readonly FaultEvent[], tick: number): RevealMark[] {
  const out: RevealMark[] = [];
  for (let k = 0; k < faults.length; k++) {
    const f = faults[k];
    if (f.tick > tick) continue;
    let target: RevealMark['target'];
    let index: number;
    if (f.kind === 'robot-freeze' || f.kind === 'slow-robot') {
      target = 'robot';
      index = f.robot;
    } else if (f.kind === 'station-slowdown') {
      target = 'station';
      index = f.station;
    } else {
      target = 'cell';
      index = f.cell;
    }
    const same = out.find((m) => m.target === target && m.index === index);
    if (same) same.tag = `${same.tag} ${faultTag(k)}`;
    else out.push({ target, index, tag: faultTag(k) });
  }
  return out;
}

/** Fault start ticks for the scrubber, in fault order. */
export function faultTicks(faults: readonly FaultEvent[]): number[] {
  return faults.map((f) => f.tick);
}
