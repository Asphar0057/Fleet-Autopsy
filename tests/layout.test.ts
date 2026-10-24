import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGrid, parseLayout, printGrid } from '../src/sim/layout';
import type { Layout, LayoutManifest, LayoutMeta } from '../src/sim/layout';
import { CellKind } from '../src/sim/types';

const dir = fileURLToPath(new URL('../public/layouts/', import.meta.url));
type PresetMeta = LayoutMeta & { stations: { id: number; x: number; y: number }[] };
const manifest = JSON.parse(readFileSync(dir + 'layouts.json', 'utf8')) as Omit<LayoutManifest, 'layouts'> & {
  layouts: PresetMeta[];
};

function loadPreset(id: string): Layout {
  const meta = manifest.layouts.find((l) => l.id === id);
  if (!meta) throw new Error(`no preset ${id}`);
  return parseLayout(meta, readFileSync(dir + meta.file, 'utf8'));
}

/** Meta whose size and counts are derived from the grid text itself. */
function metaFor(text: string, id = 'test'): LayoutMeta {
  const rows = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const all = rows.join('');
  const count = (ch: string) => [...all].filter((c) => c === ch).length;
  return {
    id,
    name: id,
    file: `${id}.txt`,
    width: rows[0].length,
    height: rows.length,
    recommendedRobots: 1,
    maxRobots: 1,
    queueCap: 1,
    recommendedTicks: 100,
    counts: {
      floor: count('.'),
      wall: count('#'),
      pods: count('p'),
      stations: count('S'),
      chargers: count('c'),
    },
  };
}

const parseText = (text: string) => parseLayout(metaFor(text), text);

/** Floor 4-neighbors of a cell, by coordinates (independent of the neighbor table). */
function floorNeighbors(l: Layout, cell: number): number[] {
  const x = cell % l.width;
  const y = Math.floor(cell / l.width);
  const out: number[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= l.width || ny >= l.height) continue;
    const n = ny * l.width + nx;
    if (l.kinds[n] === CellKind.Floor) out.push(n);
  }
  return out;
}

const PRESETS = [
  { id: 'pocket-dc', w: 24, h: 11, rec: 9, max: 12, cap: 6, stations: 2, pods: 48 },
  { id: 'fulfillment-block', w: 39, h: 23, rec: 36, max: 45, cap: 8, stations: 6, pods: 288 },
  { id: 'chokepoint', w: 35, h: 22, rec: 22, max: 28, cap: 8, stations: 3, pods: 120 },
];

describe('presets', () => {
  for (const p of PRESETS) {
    describe(p.id, () => {
      const l = loadPreset(p.id);
      const meta = manifest.layouts.find((m) => m.id === p.id)!;

      it('exposes size, robots, queue cap, and counts from layouts.json', () => {
        expect([l.width, l.height]).toEqual([p.w, p.h]);
        expect([l.recommendedRobots, l.maxRobots, l.queueCap]).toEqual([p.rec, p.max, p.cap]);
        expect(l.stations.length).toBe(p.stations);
        expect(l.pods.length).toBe(p.pods);
        expect(l.floor.length).toBe(meta.counts.floor);
        expect(l.chargers.length).toBe(meta.counts.chargers);
        expect(l.kinds.length).toBe(p.w * p.h);
      });

      it('has one connected floor region', () => {
        const seen = new Set<number>([l.floor[0]]);
        const stack = [l.floor[0]];
        while (stack.length) {
          for (const n of floorNeighbors(l, stack.pop()!)) {
            if (!seen.has(n)) {
              seen.add(n);
              stack.push(n);
            }
          }
        }
        expect(seen.size).toBe(l.floor.length);
      });

      it('every endpoint has a floor neighbor', () => {
        for (const list of [l.pods, l.stations, l.chargers]) {
          for (const c of list) expect(floorNeighbors(l, c).length).toBeGreaterThan(0);
        }
      });

      it('each station has exactly one floor neighbor, recorded as its access cell', () => {
        l.stations.forEach((cell, s) => {
          const fn = floorNeighbors(l, cell);
          expect(fn).toEqual([l.access[s]]);
          expect(l.stationAt[cell]).toBe(s);
          expect(l.accessOf[l.access[s]]).toBe(s);
        });
      });

      it('indexes stations in cell-index order matching layouts.json ids', () => {
        const fromJson = meta.stations.map((st) => st.y * l.width + st.x);
        expect([...l.stations]).toEqual(fromJson);
      });

      it('neighbor table is E, W, S, N with -1 out of bounds', () => {
        expect([...l.neighbors.subarray(0, 4)]).toEqual([1, -1, l.width, -1]);
        const last = l.width * l.height - 1;
        expect([...l.neighbors.subarray(last * 4, last * 4 + 4)]).toEqual([-1, last - 1, -1, last - l.width]);
      });
    });
  }

  it('accepts CRLF line endings', () => {
    const meta = manifest.layouts[0];
    const text = readFileSync(dir + meta.file, 'utf8');
    const crlf = text.replace(/\r?\n/g, '\r\n');
    expect(parseLayout(meta, crlf).kinds).toEqual(parseLayout(meta, text).kinds);
  });
});

describe('bad grids', () => {
  it('rejects an unknown glyph with row and col', () => {
    expect(() => parseText('###\n#x#\n###\n')).toThrow(/layout test: unknown glyph 'x' at row 1, col 1/);
  });

  it('rejects ragged rows', () => {
    expect(() => parseText('####\n#..#\n##\n')).toThrow(/ragged rows: row 2 has 2 cells, expected 4/);
  });

  it('rejects a disconnected floor', () => {
    expect(() => parseText('#####\n#.#.#\n#####\n')).toThrow(/floor is not connected \(2 separate regions\)/);
  });

  it('rejects an endpoint with no floor neighbor', () => {
    expect(() => parseText('#####\n#...#\n#####\n##p##\n')).toThrow(
      /pod slot at row 3, col 2 has no floor neighbor/,
    );
  });

  it('rejects a station with two floor neighbors', () => {
    const grid = '######\n#.S..#\n#.##.#\n#....#\n######\n';
    expect(() => parseText(grid)).toThrow(/station at row 1, col 2 has 2 floor neighbors, expected exactly 1/);
  });

  it('rejects counts that differ from layouts.json', () => {
    const grid = '####\n#.p#\n####\n';
    const meta = metaFor(grid);
    meta.counts.pods = 2;
    expect(() => parseLayout(meta, grid)).toThrow(/count mismatch: pods is 1, layouts.json says 2/);
  });
});

const GLYPHS = ['#', '.', 'p', 'S', 'c'] as const;

describe('properties', () => {
  // Feature: sim-core, Property 1: Grid round trip
  // **Validates: Requirements 1.1, 1.7, 1.8**
  it('Property 1: Grid round trip', () => {
    const gridText = fc
      .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }))
      .chain(([w, h]) =>
        fc.array(fc.array(fc.constantFrom(...GLYPHS), { minLength: w, maxLength: w }).map((r) => r.join('')), {
          minLength: h,
          maxLength: h,
        }),
      )
      .map((rows) => rows.join('\n') + '\n');
    fc.assert(
      fc.property(gridText, (t) => {
        const g = parseGrid(t);
        const printed = printGrid(g);
        expect(printed).toBe(t);
        const g2 = parseGrid(printed);
        expect(g2.width).toBe(g.width);
        expect(g2.height).toBe(g.height);
        expect(g2.kinds).toEqual(g.kinds);
      }),
      { numRuns: 100 },
    );
  });

  /** Naive reference checker on a 2D char array. */
  function referenceAccepts(rows: string[]): boolean {
    const h = rows.length;
    const w = rows[0].length;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? '' : rows[y][x]);
    const floorNb = (x: number, y: number) =>
      [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].filter((c) => c === '.').length;
    const floors: string[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[y][x] === '.') floors.push(`${x},${y}`);
    if (floors.length === 0) return false;
    const seen = new Set<string>();
    const visit = (x: number, y: number): void => {
      const k = `${x},${y}`;
      if (at(x, y) !== '.' || seen.has(k)) return;
      seen.add(k);
      visit(x + 1, y);
      visit(x - 1, y);
      visit(x, y + 1);
      visit(x, y - 1);
    };
    const [fx, fy] = floors[0].split(',').map(Number);
    visit(fx, fy);
    if (seen.size !== floors.length) return false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = rows[y][x];
        if ((c === 'p' || c === 'c') && floorNb(x, y) === 0) return false;
        if (c === 'S' && floorNb(x, y) !== 1) return false;
      }
    }
    return true;
  }

  // Feature: sim-core, Property 2: Validation agrees with a reference checker
  // **Validates: Requirements 1.3, 1.4, 1.5, 1.6**
  it('Property 2: Validation agrees with a reference checker', () => {
    // Two glyph mixes: uniform-ish (mostly rejected) and floor-heavy (often accepted).
    const mixed = fc.oneof(
      { weight: 6, arbitrary: fc.constant('.') },
      { weight: 2, arbitrary: fc.constant('#') },
      { weight: 1, arbitrary: fc.constantFrom('p', 'S', 'c') },
    );
    const floorHeavy = fc.oneof(
      { weight: 24, arbitrary: fc.constant('.') },
      { weight: 2, arbitrary: fc.constant('#') },
      { weight: 1, arbitrary: fc.constantFrom('p', 'S', 'c') },
    );
    const grid = fc
      .tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }), fc.boolean())
      .chain(([w, h, heavy]) =>
        fc.array(fc.array(heavy ? floorHeavy : mixed, { minLength: w, maxLength: w }).map((r) => r.join('')), {
          minLength: h,
          maxLength: h,
        }),
      );
    fc.assert(
      fc.property(grid, (rows) => {
        const text = rows.join('\n') + '\n';
        const expectOk = referenceAccepts(rows);
        let layout: Layout | null;
        try {
          layout = parseText(text);
        } catch {
          layout = null;
        }
        expect(layout !== null).toBe(expectOk);
        if (layout) {
          const w = layout.width;
          for (let s = 0; s < layout.stations.length; s++) {
            const st = layout.stations[s];
            const a = layout.access[s];
            expect(layout.kinds[a]).toBe(CellKind.Floor);
            const manhattan = Math.abs((st % w) - (a % w)) + Math.abs(Math.floor(st / w) - Math.floor(a / w));
            expect(manhattan).toBe(1);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
