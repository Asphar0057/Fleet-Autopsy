// Shared test helpers: load presets from public/layouts with fs (design.md D9).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { parseLayout } from '../src/sim/layout';
import type { Layout, LayoutManifest, LayoutMeta } from '../src/sim/layout';
import { createSim } from '../src/sim/sim';
import type { Sim } from '../src/sim/sim';
import type { FaultEvent } from '../src/sim/types';

const dir = fileURLToPath(new URL('../public/layouts/', import.meta.url));
const manifest = JSON.parse(readFileSync(dir + 'layouts.json', 'utf8')) as LayoutManifest;

export const PRESET_IDS = manifest.layouts.map((l) => l.id);

const cache = new Map<string, Layout>();

/** Parses a preset once per test file and reuses it. */
export function loadPreset(id: string): Layout {
  let l = cache.get(id);
  if (!l) {
    const meta = manifest.layouts.find((m) => m.id === id);
    if (!meta) throw new Error(`no preset ${id}`);
    l = parseLayout(meta, readFileSync(dir + meta.file, 'utf8'));
    cache.set(id, l);
  }
  return l;
}

/** Meta whose size and counts are derived from the grid text itself. */
export function metaFor(text: string, id = 'test'): LayoutMeta {
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
    counts: { floor: count('.'), wall: count('#'), pods: count('p'), stations: count('S'), chargers: count('c') },
  };
}

/** Generated run case for run-level properties (design.md Correctness Properties). */
export interface RunCase {
  id: string;
  seed: number;
  robots: number;
}

/** Seeds in [1, 2^31 - 1]. */
export const seedArb = fc.integer({ min: 1, max: 2 ** 31 - 1 });

/** Preset id, seed, and robots in [minRobots, recommended] for that preset. */
export function runCaseArb(minRobots = 1): fc.Arbitrary<RunCase> {
  return fc.constantFrom(...PRESET_IDS).chain((id) =>
    fc.record({
      id: fc.constant(id),
      seed: seedArb,
      robots: fc.integer({ min: minRobots, max: loadPreset(id).recommendedRobots }),
    }),
  );
}

/** Runs a case for `ticks` ticks at the preset's queue cap and returns the sim. */
export function runCase(c: RunCase, ticks: number, faults: FaultEvent[] = []): Sim {
  const layout = loadPreset(c.id);
  const sim = createSim(layout, { seed: c.seed, robots: c.robots, queueCap: layout.queueCap, faults });
  sim.run(ticks);
  return sim;
}
