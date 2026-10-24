// `npm run benchmark` (design "Benchmark (task 8)", D2): a Vitest file run by
// vitest.scripts.config.ts. BENCH_MODE = full (default) | dev | fast.
// full writes benchmark/results.json and benchmark/RESULTS.md; dev writes only
// benchmark/dev-results.json (gitignored); fast writes nothing and prints the Markdown.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { buildBenchmarkSet, renderResultsMd, runBenchmark } from '../src/diagnosis/benchmark';
import type { BenchMode } from '../src/diagnosis/benchmark';
import { parseLayout } from '../src/sim/layout';
import type { Layout, LayoutManifest } from '../src/sim/layout';

const layoutDir = fileURLToPath(new URL('../public/layouts/', import.meta.url));
const outDir = fileURLToPath(new URL('../benchmark/', import.meta.url));

function benchMode(): BenchMode {
  const m = process.env.BENCH_MODE ?? 'full';
  if (m === 'full' || m === 'dev' || m === 'fast') return m;
  throw new Error(`BENCH_MODE must be full, dev, or fast, got ${m}`);
}

/** Every preset in manifest order. */
function loadLayouts(): Layout[] {
  const manifest = JSON.parse(readFileSync(layoutDir + 'layouts.json', 'utf8')) as LayoutManifest;
  return manifest.layouts.map((meta) => parseLayout(meta, readFileSync(layoutDir + meta.file, 'utf8')));
}

it('benchmark', async () => {
  const mode = benchMode();
  const layouts = loadLayouts();
  const cases = buildBenchmarkSet(layouts, mode);
  console.log(`benchmark: mode ${mode}, ${cases.length} cases`);
  const result = await runBenchmark(layouts, cases, mode);
  const json = JSON.stringify(result, null, 2) + '\n';
  const md = renderResultsMd(result);
  if (mode === 'fast') {
    console.log(md);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  if (mode === 'dev') {
    writeFileSync(outDir + 'dev-results.json', json);
    console.log(md);
    return;
  }
  writeFileSync(outDir + 'results.json', json);
  writeFileSync(outDir + 'RESULTS.md', md);
  console.log(md);
});
