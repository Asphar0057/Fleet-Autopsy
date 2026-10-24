// Layout loader and printer. Pure: callers supply the manifest entry and grid
// text (the UI fetches, tests read with fs). See design.md D1, D9, D14.

import { CellKind } from './types';

/** One entry of `layouts.json`. Extra JSON fields (stations, zones, description) are ignored. */
export interface LayoutMeta {
  id: string;
  name: string;
  file: string;
  width: number;
  height: number;
  recommendedRobots: number;
  maxRobots: number;
  queueCap: number;
  recommendedTicks: number;
  counts: { floor: number; wall: number; pods: number; stations: number; chargers: number };
}

/** Shape of `layouts.json`. */
export interface LayoutManifest {
  layouts: LayoutMeta[];
}

export interface Layout extends Omit<LayoutMeta, 'file' | 'counts'> {
  kinds: Uint8Array; // CellKind per cell
  neighbors: Int16Array; // 4 per cell (E, W, S, N), -1 if out of bounds
  floor: Int16Array;
  pods: Int16Array;
  stations: Int16Array; // station cells in cell-index order
  chargers: Int16Array;
  access: Int16Array; // access cell per station index
  stationAt: Int16Array; // station index per cell, else -1
  accessOf: Int16Array; // station index if the cell is an access cell, else -1
}

export interface Grid {
  width: number;
  height: number;
  kinds: Uint8Array;
}

/** Glyph per CellKind value, indexed by kind. */
const GLYPH = ['#', '.', 'p', 'S', 'c'] as const;

/** Largest cell count whose indices fit in an Int16Array. */
const MAX_CELLS = 32767;

function glyphKind(ch: string): number {
  switch (ch) {
    case '#':
      return CellKind.Wall;
    case '.':
      return CellKind.Floor;
    case 'p':
      return CellKind.Pod;
    case 'S':
      return CellKind.Station;
    case 'c':
      return CellKind.Charger;
    default:
      return -1;
  }
}

function isEndpoint(kind: number): boolean {
  return kind === CellKind.Pod || kind === CellKind.Station || kind === CellKind.Charger;
}

function kindName(kind: number): string {
  if (kind === CellKind.Pod) return 'pod slot';
  if (kind === CellKind.Station) return 'station';
  return 'charger';
}

/**
 * Parses grid text into cell kinds. Accepts LF or CRLF line endings and
 * trailing newlines. Throws on an empty grid, ragged rows, or an unknown glyph.
 */
export function parseGrid(text: string, id = 'grid'): Grid {
  const norm = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (norm.length === 0) throw new Error(`layout ${id}: grid is empty`);
  const rows = norm.split('\n');
  const height = rows.length;
  const width = rows[0].length;
  if (width * height > MAX_CELLS) {
    throw new Error(`layout ${id}: grid has ${width * height} cells, max is ${MAX_CELLS}`);
  }
  const kinds = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    if (row.length !== width) {
      throw new Error(
        `layout ${id}: ragged rows: row ${y} has ${row.length} cells, expected ${width} (row 0 width)`,
      );
    }
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      const k = glyphKind(ch);
      if (k < 0) {
        throw new Error(`layout ${id}: unknown glyph '${ch}' at row ${y}, col ${x}`);
      }
      kinds[y * width + x] = k;
    }
  }
  return { width, height, kinds };
}

/** Formats a grid as text: one line per row, each terminated by '\n'. */
export function printGrid(g: Grid): string {
  let out = '';
  for (let y = 0; y < g.height; y++) {
    let row = '';
    for (let x = 0; x < g.width; x++) row += GLYPH[g.kinds[y * g.width + x]];
    out += row + '\n';
  }
  return out;
}

/** Builds the E, W, S, N neighbor table; -1 where the neighbor is out of bounds. */
function buildNeighbors(width: number, height: number): Int16Array {
  const nb = new Int16Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      nb[i * 4] = x + 1 < width ? i + 1 : -1;
      nb[i * 4 + 1] = x > 0 ? i - 1 : -1;
      nb[i * 4 + 2] = y + 1 < height ? i + width : -1;
      nb[i * 4 + 3] = y > 0 ? i - width : -1;
    }
  }
  return nb;
}

/** Flood-fills floor cells from `start`, marking `label` in `comp`. */
function fillFloor(
  start: number,
  label: number,
  kinds: Uint8Array,
  nb: Int16Array,
  comp: Int16Array,
  queue: Int16Array,
): void {
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  comp[start] = label;
  while (head < tail) {
    const c = queue[head++];
    for (let d = 0; d < 4; d++) {
      const n = nb[c * 4 + d];
      if (n >= 0 && comp[n] < 0 && kinds[n] === CellKind.Floor) {
        comp[n] = label;
        queue[tail++] = n;
      }
    }
  }
}

function collect(kinds: Uint8Array, kind: number, count: number): Int16Array {
  const out = new Int16Array(count);
  let k = 0;
  for (let i = 0; i < kinds.length; i++) if (kinds[i] === kind) out[k++] = i;
  return out;
}

/**
 * Parses and validates a layout. Validation order (design.md): glyphs and
 * rectangular shape; size and counts match `meta`; floor is one connected
 * region; every Endpoint has a floor neighbor; every station has exactly one
 * floor neighbor, stored as its Access_Cell. Throws a descriptive Error.
 */
export function parseLayout(meta: LayoutMeta, gridText: string): Layout {
  const id = meta.id;
  const { width, height, kinds } = parseGrid(gridText, id);

  if (width !== meta.width || height !== meta.height) {
    throw new Error(
      `layout ${id}: size mismatch: grid is ${width}x${height}, layouts.json says ${meta.width}x${meta.height}`,
    );
  }

  const cells = width * height;
  const tally = [0, 0, 0, 0, 0];
  for (let i = 0; i < cells; i++) tally[kinds[i]]++;
  const expected: [string, number, number][] = [
    ['floor', tally[CellKind.Floor], meta.counts.floor],
    ['wall', tally[CellKind.Wall], meta.counts.wall],
    ['pods', tally[CellKind.Pod], meta.counts.pods],
    ['stations', tally[CellKind.Station], meta.counts.stations],
    ['chargers', tally[CellKind.Charger], meta.counts.chargers],
  ];
  for (const [name, got, want] of expected) {
    if (got !== want) {
      throw new Error(`layout ${id}: count mismatch: ${name} is ${got}, layouts.json says ${want}`);
    }
  }

  const neighbors = buildNeighbors(width, height);

  // Floor connectivity.
  const floorCount = tally[CellKind.Floor];
  if (floorCount === 0) throw new Error(`layout ${id}: grid has no floor cells`);
  const comp = new Int16Array(cells).fill(-1);
  const queue = new Int16Array(cells);
  let regions = 0;
  for (let i = 0; i < cells; i++) {
    if (kinds[i] === CellKind.Floor && comp[i] < 0) {
      fillFloor(i, regions, kinds, neighbors, comp, queue);
      regions++;
    }
  }
  if (regions !== 1) {
    throw new Error(`layout ${id}: floor is not connected (${regions} separate regions)`);
  }

  // Endpoints need a floor neighbor; stations need exactly one.
  const stationCount = tally[CellKind.Station];
  const access = new Int16Array(stationCount);
  const stationAt = new Int16Array(cells).fill(-1);
  const accessOf = new Int16Array(cells).fill(-1);
  for (let i = 0; i < cells; i++) {
    const k = kinds[i];
    if (!isEndpoint(k)) continue;
    let floorNb = 0;
    for (let d = 0; d < 4; d++) {
      const n = neighbors[i * 4 + d];
      if (n >= 0 && kinds[n] === CellKind.Floor) floorNb++;
    }
    if (floorNb === 0) {
      throw new Error(
        `layout ${id}: ${kindName(k)} at row ${Math.floor(i / width)}, col ${i % width} has no floor neighbor`,
      );
    }
  }
  let s = 0;
  for (let i = 0; i < cells; i++) {
    if (kinds[i] !== CellKind.Station) continue;
    let floorNb = 0;
    let acc = -1;
    for (let d = 0; d < 4; d++) {
      const n = neighbors[i * 4 + d];
      if (n >= 0 && kinds[n] === CellKind.Floor) {
        floorNb++;
        acc = n;
      }
    }
    if (floorNb !== 1) {
      throw new Error(
        `layout ${id}: station at row ${Math.floor(i / width)}, col ${i % width} has ${floorNb} floor neighbors, expected exactly 1`,
      );
    }
    access[s] = acc;
    stationAt[i] = s;
    // If two stations share an access cell, the lower station index keeps it (stable order).
    if (accessOf[acc] < 0) accessOf[acc] = s;
    s++;
  }

  return {
    id,
    name: meta.name,
    width,
    height,
    recommendedRobots: meta.recommendedRobots,
    maxRobots: meta.maxRobots,
    queueCap: meta.queueCap,
    recommendedTicks: meta.recommendedTicks,
    kinds,
    neighbors,
    floor: collect(kinds, CellKind.Floor, floorCount),
    pods: collect(kinds, CellKind.Pod, tally[CellKind.Pod]),
    stations: collect(kinds, CellKind.Station, stationCount),
    chargers: collect(kinds, CellKind.Charger, tally[CellKind.Charger]),
    access,
    stationAt,
    accessOf,
  };
}
