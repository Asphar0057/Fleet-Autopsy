// Fault model (Spec 2): activity windows and creation-time validation.
// Pure functions; no module-level mutable state. See design.md D1, D8.

import type { Layout } from './layout';
import { CellKind } from './types';
import type { FaultEvent } from './types';

/** Integer range for station-slowdown `factor` and slow-robot `period`. */
export const FAULT_PARAM_MIN = 2;
export const FAULT_PARAM_MAX = 4;

/** True when frame tick `t` is inside the fault's window (D1). */
export function isActive(f: FaultEvent, t: number): boolean {
  if (t < f.tick) return false;
  return f.duration === null || t < f.tick + f.duration;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function inRange(v: unknown, lo: number, hi: number): boolean {
  return isInt(v) && v >= lo && v <= hi;
}

function rc(layout: Layout, c: number): string {
  return `row ${Math.floor(c / layout.width)}, col ${c % layout.width}`;
}

function kindName(kind: number): string {
  if (kind === CellKind.Pod) return 'pod slot';
  if (kind === CellKind.Station) return 'station';
  return 'charger';
}

/**
 * Checks a set of blocked cells against D8, assuming each cell is plain floor
 * and not an Access_Cell. Returns null if valid, else the reason. `mask` is a
 * scratch buffer of cells.length, all zero on entry and on return.
 */
function unionProblem(layout: Layout, cells: ArrayLike<number>, mask: Uint8Array): string | null {
  const { kinds, neighbors, floor } = layout;
  for (let k = 0; k < cells.length; k++) mask[cells[k]] = 1;
  let problem: string | null = null;

  // Connectivity of floor minus the union.
  let start = -1;
  let remaining = 0;
  for (let k = 0; k < floor.length; k++) {
    if (mask[floor[k]] === 0) {
      remaining++;
      if (start < 0) start = floor[k];
    }
  }
  if (start < 0) {
    problem = 'blocks every floor cell';
  } else {
    const seen = new Uint8Array(kinds.length);
    const queue = new Int32Array(kinds.length);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const c = queue[head++];
      for (let d = 0; d < 4; d++) {
        const nb = neighbors[c * 4 + d];
        if (nb >= 0 && seen[nb] === 0 && mask[nb] === 0 && kinds[nb] === CellKind.Floor) {
          seen[nb] = 1;
          queue[tail++] = nb;
        }
      }
    }
    if (tail !== remaining) problem = 'disconnects the floor';
  }

  // Every endpoint keeps a floor neighbor outside the union.
  if (problem === null) {
    for (let c = 0; c < kinds.length && problem === null; c++) {
      const k = kinds[c];
      if (k !== CellKind.Pod && k !== CellKind.Station && k !== CellKind.Charger) continue;
      let ok = false;
      for (let d = 0; d < 4; d++) {
        const nb = neighbors[c * 4 + d];
        if (nb >= 0 && kinds[nb] === CellKind.Floor && mask[nb] === 0) {
          ok = true;
          break;
        }
      }
      if (!ok) problem = `leaves the ${kindName(k)} at ${rc(layout, c)} without a floor neighbor`;
    }
  }

  for (let k = 0; k < cells.length; k++) mask[cells[k]] = 0;
  return problem;
}

/** Field-level problem for one fault, or null. */
function fieldProblem(layout: Layout, robots: number, f: FaultEvent): string | null {
  if (!inRange(f.tick, 1, Number.MAX_SAFE_INTEGER)) return `tick must be an integer >= 1, got ${String(f.tick)}`;
  if (f.duration !== null && !inRange(f.duration, 1, Number.MAX_SAFE_INTEGER)) {
    return `duration must be null or an integer >= 1, got ${String(f.duration)}`;
  }
  switch (f.kind) {
    case 'robot-freeze':
      return inRange(f.robot, 0, robots - 1) ? null : `robot must be an integer in [0, ${robots - 1}], got ${String(f.robot)}`;
    case 'slow-robot':
      if (!inRange(f.robot, 0, robots - 1)) return `robot must be an integer in [0, ${robots - 1}], got ${String(f.robot)}`;
      return inRange(f.period, FAULT_PARAM_MIN, FAULT_PARAM_MAX)
        ? null
        : `period must be an integer in [${FAULT_PARAM_MIN}, ${FAULT_PARAM_MAX}], got ${String(f.period)}`;
    case 'station-slowdown': {
      const S = layout.stations.length;
      if (!inRange(f.station, 0, S - 1)) return `station must be an integer in [0, ${S - 1}], got ${String(f.station)}`;
      return inRange(f.factor, FAULT_PARAM_MIN, FAULT_PARAM_MAX)
        ? null
        : `factor must be an integer in [${FAULT_PARAM_MIN}, ${FAULT_PARAM_MAX}], got ${String(f.factor)}`;
    }
    case 'blocked-cell': {
      const cells = layout.kinds.length;
      if (!inRange(f.cell, 0, cells - 1)) return `cell must be an integer in [0, ${cells - 1}], got ${String(f.cell)}`;
      if (layout.kinds[f.cell] !== CellKind.Floor) return `blocked cell at ${rc(layout, f.cell)} is not plain floor`;
      if (layout.accessOf[f.cell] >= 0) {
        return `blocked cell at ${rc(layout, f.cell)} is the access cell of station ${layout.accessOf[f.cell]}`;
      }
      return null;
    }
    default: {
      const unknown: { kind?: unknown } = f;
      return `unknown fault kind '${String(unknown.kind)}'`;
    }
  }
}

/**
 * Validates faults at sim creation: field ranges per kind, then the D8 check on
 * the union of all blocked cells regardless of timing. Throws a descriptive
 * Error naming the fault index and the reason.
 */
export function validateFaults(layout: Layout, robots: number, faults: readonly FaultEvent[]): void {
  const blockIdx: number[] = [];
  const blockCells: number[] = [];
  for (let i = 0; i < faults.length; i++) {
    const f = faults[i];
    const p = fieldProblem(layout, robots, f);
    if (p !== null) throw new Error(`fault ${i} (${String(f.kind)}): ${p}`);
    if (f.kind === 'blocked-cell') {
      blockIdx.push(i);
      blockCells.push(f.cell);
    }
  }
  if (blockCells.length === 0) return;
  const mask = new Uint8Array(layout.kinds.length);
  // Single-cell problems first, so the error can name one fault.
  for (let k = 0; k < blockCells.length; k++) {
    const p = unionProblem(layout, [blockCells[k]], mask);
    if (p !== null) throw new Error(`fault ${blockIdx[k]} (blocked-cell): blocked cell at ${rc(layout, blockCells[k])} ${p}`);
  }
  const p = unionProblem(layout, blockCells, mask);
  if (p !== null) throw new Error(`faults ${blockIdx.join(', ')} (blocked-cell): blocked cells together ${p}`);
}

/** Floor cells that are not Access_Cells and pass D8 when blocked alone, in cell-index order. */
export function blockableCells(layout: Layout): Int16Array {
  const mask = new Uint8Array(layout.kinds.length);
  const out: number[] = [];
  const one = [0];
  for (let k = 0; k < layout.floor.length; k++) {
    const c = layout.floor[k];
    if (layout.accessOf[c] >= 0) continue;
    one[0] = c;
    if (unionProblem(layout, one, mask) === null) out.push(c);
  }
  return Int16Array.from(out);
}
