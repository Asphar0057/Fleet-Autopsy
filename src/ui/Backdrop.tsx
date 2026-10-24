// Landing backdrop: the curated jam "Pocket DC · decoy, then frozen holder"
// (pd-decoy-first) played from tick 0 to END_TICK at about 3x, then held. Stalled
// robots get the simulator's grey rings; once the playhead passes the primary
// fault's tick, accent ripples and a glow spread from the frozen robot's cell,
// drawn on the same canvas with the same cell size. Own rAF loop, paused while
// the document is hidden. Reduced motion: one static frame at END_TICK with three
// still rings. Any load failure renders nothing.
import { useEffect, useRef, useState } from 'react';
import { drawFrame, fitCanvas, readColors } from '../render/canvasRenderer';
import type { Colors } from '../render/canvasRenderer';
import type { Layout } from '../sim/layout';
import { stalledAt } from '../sim/metrics';
import { positionsAt } from '../sim/recorder';
import { SCENARIOS, scenarioConfig } from '../sim/scenarios';
import { createSim } from '../sim/sim';
import type { Sim } from '../sim/sim';
import { loadLayout, loadManifest } from './loaders';
import { BASE_TICKS_PER_SECOND } from './playback';
import {
  BACKDROP_SCENARIO,
  backdropCulprit,
  END_TICK,
  GLOW_R,
  RINGS,
  ringAt,
  SPEED,
  staticRings,
} from './landing/backdropJam';
import type { Culprit } from './landing/backdropJam';

const STEP_MS = 1000 / (BASE_TICKS_PER_SECOND * SPEED);
const MAX_STEPS_PER_FRAME = 2;
const MAX_DPR = 1.5;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** fitCanvas, then the backing store at a device pixel ratio capped at MAX_DPR. Returns the cell size. */
function fitCapped(canvas: HTMLCanvasElement, layout: Layout): number {
  const { cell } = fitCanvas(canvas, layout);
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  canvas.width = Math.round(layout.width * cell * dpr);
  canvas.height = Math.round(layout.height * cell * dpr);
  canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return cell;
}

/** Glow and rings around the culprit's cell, in canvas CSS pixels. */
function drawRipples(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  colors: Colors,
  rings: readonly { r: number; alpha: number }[],
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, GLOW_R * cell);
  g.addColorStop(0, 'rgba(255, 74, 28, 0.35)');
  g.addColorStop(1, 'rgba(255, 74, 28, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - GLOW_R * cell, y - GLOW_R * cell, 2 * GLOW_R * cell, 2 * GLOW_R * cell);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 1;
  for (const ring of rings) {
    ctx.globalAlpha = ring.alpha;
    ctx.beginPath();
    ctx.arc(x, y, ring.r * cell, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function Backdrop() {
  const [state, setState] = useState<{ sim: Sim; culprit: Culprit | null } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Manifest, layout, and the scenario's Sim (same scenarioConfig as the app), once.
  useEffect(() => {
    let cancelled = false;
    const scenario = SCENARIOS.find((s) => s.id === BACKDROP_SCENARIO);
    if (!scenario) return;
    loadManifest()
      .then(async (metas) => {
        const meta = metas.find((m) => m.id === scenario.layoutId);
        if (!meta) throw new Error(`missing layout ${scenario.layoutId}`);
        const layout = await loadLayout(meta);
        const config = scenarioConfig(scenario, layout);
        return {
          sim: createSim(layout, config),
          culprit: backdropCulprit(config.faults, scenario.groundTruth.primaryFaultIndex),
        };
      })
      .then(
        (s) => {
          if (!cancelled) setState(s);
        },
        () => undefined, // the landing page works without the backdrop
      );
    return () => {
      cancelled = true;
    };
  }, []);

  // Draw loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    const ctx = canvas?.getContext('2d');
    if (!state || !canvas || !box || !ctx) return;
    const { sim, culprit } = state;
    const lay = sim.layout;
    const stalled = new Uint8Array(sim.config.robots);
    // The culprit shows only its ripples, no grey stall ring or label (Accent rules).
    const skip = new Uint8Array(sim.config.robots);
    if (culprit) skip[culprit.robot] = 1;
    const colors = readColors();
    const opts = {
      trails: false,
      congestion: false,
      waitCounts: null,
      stalled,
      blocked: null,
      reveal: null,
      revealSkip: skip,
      colors,
    };
    const reduced = prefersReducedMotion();
    let cell = fitCapped(canvas, lay);
    let rippleStart = -1; // performance.now() when the playhead passed the fault tick
    const rings: { r: number; alpha: number }[] = [];

    const draw = (now: number) => {
      const t = sim.tick;
      stalledAt(sim.recording, t, stalled);
      drawFrame(ctx, lay, sim.recording, t, opts);
      if (!culprit || t < culprit.tick) return;
      rings.length = 0;
      if (reduced) {
        rings.push(...staticRings());
      } else {
        if (rippleStart < 0) rippleStart = now;
        for (let i = 0; i < RINGS; i++) {
          const ring = ringAt(now - rippleStart, i);
          if (ring) rings.push(ring);
        }
      }
      const c = positionsAt(sim.recording, t)[culprit.robot];
      drawRipples(ctx, ((c % lay.width) + 0.5) * cell, (Math.floor(c / lay.width) + 0.5) * cell, cell, colors, rings);
    };

    let cancelled = false;
    let raf = 0;
    if (reduced) sim.run(Math.max(0, END_TICK - sim.tick));

    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            cell = fitCapped(canvas, lay);
            if (reduced) draw(0);
          })
        : null;
    observer?.observe(box);

    // Station digits use Montserrat 500; redraw once the font is ready (reduced motion only; the loop redraws anyway).
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts && reduced) {
      fonts.load(`500 11px 'Montserrat'`).then(
        () => {
          if (!cancelled) draw(0);
        },
        () => undefined,
      );
    }

    if (reduced) {
      draw(0);
      return () => {
        cancelled = true;
        observer?.disconnect();
      };
    }

    // Every frame redraws (the ripples move); the sim advances about 30 ticks/s until END_TICK.
    let acc = 0;
    let last = -1;
    const frame = (now: number) => {
      if (last >= 0 && sim.tick < END_TICK) {
        acc += now - last;
        let steps = 0;
        while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME && sim.tick < END_TICK) {
          sim.step();
          acc -= STEP_MS;
          steps++;
        }
        if (steps === MAX_STEPS_PER_FRAME) acc = 0;
      }
      last = now;
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf !== 0) return;
      last = -1;
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
  }, [state]);

  if (!state) return null;
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-box" ref={boxRef}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
