// Landing backdrop (visual-redesign Requirement 1.5, 1.6): a healthy seeded fleet
// on the fulfillment-block layout, drawn at low contrast behind the landing text.
// Own Sim and rAF loop; the loop pauses while the document is hidden. Under
// prefers-reduced-motion it draws one static frame. Any load failure renders nothing.
import { useEffect, useRef, useState } from 'react';
import { drawFrame, fitCanvas, readColors } from '../render/canvasRenderer';
import type { Layout } from '../sim/layout';
import { createSim } from '../sim/sim';
import type { Sim } from '../sim/sim';
import { loadLayout, loadManifest } from './loaders';

const BACKDROP_LAYOUT = 'fulfillment-block';
const BACKDROP_SEED = 42;
const STEP_MS = 160; // about 6 ticks per second
const STATIC_TICKS = 120; // reduced motion: advance headless, then draw once

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Backdrop() {
  const [sim, setSim] = useState<Sim | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Manifest, layout, and a healthy Sim, once.
  useEffect(() => {
    let cancelled = false;
    loadManifest()
      .then(async (metas) => {
        const meta = metas.find((m) => m.id === BACKDROP_LAYOUT);
        if (!meta) throw new Error(`missing layout ${BACKDROP_LAYOUT}`);
        const layout: Layout = await loadLayout(meta);
        return createSim(layout, {
          seed: BACKDROP_SEED,
          robots: meta.recommendedRobots,
          queueCap: layout.queueCap,
          faults: [],
        });
      })
      .then(
        (s) => {
          if (!cancelled) setSim(s);
        },
        () => undefined, // the landing page works without the backdrop
      );
    return () => {
      cancelled = true;
    };
  }, []);

  // Draw loop for the Sim.
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    const ctx = canvas?.getContext('2d');
    if (!sim || !canvas || !box || !ctx) return;
    const lay = sim.layout;
    const stalled = new Uint8Array(sim.config.robots); // always zero: no stall rings or labels
    const colors = readColors();
    const opts = {
      trails: false,
      congestion: false,
      waitCounts: null,
      stalled,
      blocked: null,
      reveal: null,
      colors,
    };
    const draw = () => drawFrame(ctx, lay, sim.recording, sim.tick, opts);

    let cancelled = false;
    let raf = 0;
    let dirty = true;
    const reduced = prefersReducedMotion();
    if (reduced) sim.run(Math.max(0, STATIC_TICKS - sim.tick));

    const redraw = () => {
      if (reduced) draw();
      else dirty = true;
    };

    fitCanvas(canvas, lay);
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            fitCanvas(canvas, lay);
            redraw();
          })
        : null;
    observer?.observe(box);

    // Station digits use Montserrat 500; redraw once the font is ready.
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts) {
      fonts.load(`500 11px 'Montserrat'`).then(
        () => {
          if (!cancelled) redraw();
        },
        () => undefined,
      );
    }

    if (reduced) {
      draw();
      return () => {
        cancelled = true;
        observer?.disconnect();
      };
    }

    let lastStep = -1;
    const frame = (now: number) => {
      if (lastStep < 0) lastStep = now;
      // At most one tick per frame, so a long pause never causes a burst.
      if (now - lastStep >= STEP_MS) {
        lastStep = now;
        sim.step();
        dirty = true;
      }
      if (dirty) {
        dirty = false;
        draw();
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf !== 0) return;
      lastStep = -1;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf === 0) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, [sim]);

  if (!sim) return null;
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-box" ref={boxRef}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
