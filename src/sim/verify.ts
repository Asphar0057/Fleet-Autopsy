// Independent run verifier. Reads only the Recording and the Layout, never Sim
// internals. Rules: same-cell, swap, jump, illegal-cell (design.md D5), plus
// blocked-cell when faults are given (Spec 2): engagement is recomputed from the
// Recording by blockWindows (D7).

import { blockWindows } from './faults';
import type { Layout } from './layout';
import type { Recording } from './recorder';
import { CellKind } from './types';
import type { FaultEvent, Violation } from './types';

function adjacent(layout: Layout, a: number, b: number): boolean {
  for (let d = 0; d < 4; d++) if (layout.neighbors[a * 4 + d] === b) return true;
  return false;
}

/**
 * Checks a run. With `faults`, also reports a `blocked-cell` Violation for every
 * frame in which a robot stands on an Engaged_Block (reported after the Spec 1
 * rules, by fault index, then tick, then robot id).
 */
export function verifyRun(rec: Recording, layout: Layout, faults?: readonly FaultEvent[]): Violation[] {
  const out = verifySpec1(rec, layout);
  if (faults && faults.length > 0) verifyBlocks(rec, faults, out);
  return out;
}

function verifyBlocks(rec: Recording, faults: readonly FaultEvent[], out: Violation[]): void {
  const windows = blockWindows(faults, rec);
  const n = rec.robots;
  const { positions } = rec;
  for (let k = 0; k < faults.length; k++) {
    const f = faults[k];
    if (f.kind !== 'blocked-cell') continue;
    const start = windows[2 * k];
    if (start < 0) continue;
    const end = windows[2 * k + 1];
    for (let t = start; t < end; t++) {
      const o = t * n;
      for (let r = 0; r < n; r++) {
        if (positions[o + r] === f.cell) out.push({ kind: 'blocked-cell', tick: t, robots: [r] });
      }
    }
  }
}

function verifySpec1(rec: Recording, layout: Layout): Violation[] {
  const out: Violation[] = [];
  const n = rec.robots;
  const cells = layout.kinds.length;
  // Per-cell owner of the current and previous frame, valid when the stamp matches.
  let curStamp = new Int32Array(cells).fill(-1);
  let curOwner = new Int16Array(cells);
  let prevStamp = new Int32Array(cells).fill(-1);
  let prevOwner = new Int16Array(cells);
  const { positions, goals } = rec;

  for (let t = 0; t < rec.frames; t++) {
    const o = t * n;
    const p = o - n;
    for (let r = 0; r < n; r++) {
      const c = positions[o + r];
      if (c < 0 || c >= cells) {
        out.push({ kind: 'illegal-cell', tick: t, robots: [r] });
        continue;
      }
      // Same cell within the frame.
      if (curStamp[c] === t) out.push({ kind: 'same-cell', tick: t, robots: [curOwner[c], r] });
      else {
        curStamp[c] = t;
        curOwner[c] = r;
      }
      // Illegal cell: walls always; an Endpoint unless it is the goal or the robot was already there.
      const k = layout.kinds[c];
      const prev = t > 0 ? positions[p + r] : -1;
      if (k === CellKind.Wall) out.push({ kind: 'illegal-cell', tick: t, robots: [r] });
      else if (k !== CellKind.Floor && goals[o + r] !== c && prev !== c) {
        out.push({ kind: 'illegal-cell', tick: t, robots: [r] });
      }
      // Jump against the previous frame.
      if (t > 0 && prev !== c && prev >= 0 && prev < cells && !adjacent(layout, prev, c)) {
        out.push({ kind: 'jump', tick: t, robots: [r] });
      }
    }
    // Swap: r moved into j's old cell while j moved into r's old cell. Reported once (r < j).
    if (t > 0) {
      for (let r = 0; r < n; r++) {
        const c = positions[o + r];
        const prev = positions[p + r];
        if (c === prev || c < 0 || c >= cells || prevStamp[c] !== t - 1) continue;
        const j = prevOwner[c];
        if (j > r && positions[o + j] === prev) out.push({ kind: 'swap', tick: t, robots: [r, j] });
      }
    }
    const s = prevStamp;
    prevStamp = curStamp;
    curStamp = s;
    const w = prevOwner;
    prevOwner = curOwner;
    curOwner = w;
  }
  return out;
}
