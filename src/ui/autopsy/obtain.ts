// Getting an autopsy for the current run: the precomputed file for a curated
// scenario, otherwise a worker diagnosis (retried once) plus verifyFix.
import { diagnoseInWorker } from '../../diagnosis/client';
import { FIX_TICKS, verifyFix } from '../../diagnosis/fix';
import type { Jam } from '../../sim/jam';
import type { Layout, LayoutMeta } from '../../sim/layout';
import type { Recording } from '../../sim/recorder';
import { createSim } from '../../sim/sim';
import type { SimConfig } from '../../sim/types';
import { CURATED_AUTOPSIES } from './types';
import type { AutopsyData } from './types';

export function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

export async function loadCuratedAutopsy(id: string): Promise<AutopsyData> {
  const res = await fetch(`${import.meta.env.BASE_URL}autopsies/${id}.json`);
  if (!res.ok) throw new Error(`${id}.json: http ${res.status}`);
  return (await res.json()) as AutopsyData;
}

export interface ObtainArgs {
  scenarioId: string | null;
  layout: Layout;
  meta: LayoutMeta;
  world: SimConfig;
  rec: Recording;
  jam: Jam;
  signal: AbortSignal;
  onProgress(done: number, total: number): void;
}

export async function obtainAutopsy(p: ObtainArgs): Promise<AutopsyData> {
  if (p.scenarioId !== null && CURATED_AUTOPSIES.includes(p.scenarioId)) return loadCuratedAutopsy(p.scenarioId);
  const res = await fetch(`${import.meta.env.BASE_URL}layouts/${p.meta.file}`);
  if (!res.ok) throw new Error(`${p.meta.file}: http ${res.status}`);
  const gridText = await res.text();
  const req = {
    meta: p.meta,
    gridText,
    config: { seed: p.world.seed, robots: p.world.robots, queueCap: p.world.queueCap },
    rec: p.rec,
    jam: p.jam,
  };
  const opts = { signal: p.signal, onProgress: (done: number, total: number) => p.onProgress(done, total) };
  let d;
  try {
    d = await diagnoseInWorker(req, opts);
  } catch (e) {
    if (isAbort(e) || p.signal.aborted) throw e;
    d = await diagnoseInWorker(req, opts); // one automatic retry
  }
  // Let the UI paint before the fix runs (three headless runs on the main thread).
  await new Promise((r) => setTimeout(r, 0));
  const fix = verifyFix(p.layout, p.world, d);
  return { scenarioId: p.scenarioId, layoutId: p.layout.id, seed: p.world.seed, robots: p.world.robots, ticks: FIX_TICKS, jam: p.jam, diagnosis: d, fix };
}

/** Runs a sim for `ticks` ticks in 100-tick slices so the page stays responsive. */
export function simulateAsync(layout: Layout, config: SimConfig, ticks: number, signal: AbortSignal): Promise<Recording> {
  return new Promise((resolve, reject) => {
    let sim;
    try {
      sim = createSim(layout, config);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const s = sim;
    const slice = () => {
      if (signal.aborted) return;
      const end = Math.min(ticks, s.tick + 100);
      while (s.tick < end) s.step();
      if (s.tick >= ticks) resolve(s.recording);
      else setTimeout(slice, 0);
    };
    setTimeout(slice, 0);
  });
}
