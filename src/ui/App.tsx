// Minimal app: loads fulfillment-block, runs the sim at 10 ticks/s, and draws
// the latest tick. Full controls, panel, and scrubber arrive in task 9.
import { useEffect, useRef, useState } from 'react';
import { drawFrame, fitCanvas, readColors } from '../render/canvasRenderer';
import type { DrawOptions } from '../render/canvasRenderer';
import { parseLayout } from '../sim/layout';
import type { Layout, LayoutManifest } from '../sim/layout';
import { createSim } from '../sim/sim';
import type { Sim } from '../sim/sim';

const LAYOUT_ID = 'fulfillment-block';
const ROBOTS = 36;
const DEFAULT_SEED = 42;
const TICKS_PER_SECOND = 10;
const MAX_STEPS_PER_FRAME = 5; // cap catch-up after a background tab

async function loadLayout(id: string): Promise<Layout> {
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}layouts/layouts.json`);
  if (!res.ok) throw new Error(`layouts.json: http ${res.status}`);
  const manifest = (await res.json()) as LayoutManifest;
  const meta = manifest.layouts.find((m) => m.id === id);
  if (!meta) throw new Error(`layouts.json: no layout '${id}'`);
  const grid = await fetch(`${base}layouts/${meta.file}`);
  if (!grid.ok) throw new Error(`${meta.file}: http ${grid.status}`);
  return parseLayout(meta, await grid.text());
}

export function App() {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadLayout(LAYOUT_ID).then(
      (l) => {
        if (!cancelled) setLayout(l);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    const ctx = canvas?.getContext('2d');
    if (!layout || !canvas || !box || !ctx) return;

    let sim: Sim;
    try {
      sim = createSim(layout, { seed: DEFAULT_SEED, robots: ROBOTS, queueCap: layout.queueCap, faults: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const opts: DrawOptions = {
      trails: false,
      congestion: false,
      waitCounts: null,
      stalled: new Uint8Array(ROBOTS),
      colors: readColors(),
    };
    const draw = () => drawFrame(ctx, layout, sim.recording, sim.tick, opts);

    const observer = new ResizeObserver(() => {
      fitCanvas(canvas, layout);
      draw();
    });
    observer.observe(box);
    fitCanvas(canvas, layout);
    draw();

    const interval = 1000 / TICKS_PER_SECOND;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const frame = (now: number) => {
      acc += now - last;
      last = now;
      let steps = 0;
      while (acc >= interval && steps < MAX_STEPS_PER_FRAME) {
        sim.step();
        acc -= interval;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0;
      if (steps > 0) draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [layout]);

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontWeight: 400 }}>
        Fleet <em>Autopsy</em>
      </h1>
      {error !== null && <pre style={{ fontFamily: 'ui-monospace, monospace' }}>{error}</pre>}
      <div ref={boxRef} style={{ width: '100%', height: 'calc(100vh - 160px)', minHeight: 240 }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} aria-label="warehouse floor, robots moving" role="img" />
      </div>
      <p>validated in simulation only</p>
    </main>
  );
}
