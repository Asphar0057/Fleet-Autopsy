// Shared test helpers: load presets from public/layouts with fs (design.md D9).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLayout } from '../src/sim/layout';
import type { Layout, LayoutManifest } from '../src/sim/layout';

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
