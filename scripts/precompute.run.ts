// `npm run precompute` (design "Precomputed autopsies (task 11)", D2): a Vitest
// file run by vitest.scripts.config.ts. Writes public/autopsies/<scenarioId>.json
// for the 6 curated scenarios. Output is byte-identical on repeated runs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { buildAutopsy } from '../src/diagnosis/benchmark';
import { parseLayout } from '../src/sim/layout';
import type { Layout, LayoutManifest } from '../src/sim/layout';
import { SCENARIOS } from '../src/sim/scenarios';

const layoutDir = fileURLToPath(new URL('../public/layouts/', import.meta.url));
const outDir = fileURLToPath(new URL('../public/autopsies/', import.meta.url));

/** Every preset in manifest order. */
function loadLayouts(): Layout[] {
  const manifest = JSON.parse(readFileSync(layoutDir + 'layouts.json', 'utf8')) as LayoutManifest;
  return manifest.layouts.map((meta) => parseLayout(meta, readFileSync(layoutDir + meta.file, 'utf8')));
}

it('precompute', async () => {
  const layouts = loadLayouts();
  mkdirSync(outDir, { recursive: true });
  for (const s of SCENARIOS) {
    const layout = layouts.find((l) => l.id === s.layoutId);
    if (!layout) throw new Error(`precompute: no layout ${s.layoutId}`);
    const text = await buildAutopsy(layout, s);
    writeFileSync(outDir + `${s.id}.json`, text);
    console.log(`precompute: ${s.id}.json, ${text.length} bytes`);
  }
});
