// Canvas 2D renderer, blueprint style (steering design.md, canvas drawing rules).
// Stateless: every call draws a full frame from the Layout and the Recording.
// Imports sim types and pure read helpers only.

import type { Layout } from '../sim/layout';
import { positionsAt, statesAt } from '../sim/recorder';
import type { Recording } from '../sim/recorder';
import { CellKind, RState } from '../sim/types';

export interface Colors {
  ink: string;
  bg: string;
  accent: string;
}

export interface DrawOptions {
  trails: boolean; // task 9
  congestion: boolean; // task 9
  waitCounts: Uint16Array | null; // task 9
  stalled: Uint8Array; // 1 per robot; task 9
  /** Colors read once at mount via `readColors`; defaults to the design tokens. */
  colors?: Colors;
}

export const DEFAULT_COLORS: Colors = { ink: '#000000', bg: '#ffffff', accent: '#ff4a1c' };

const WALL_WIDTH = 1.4;
const SLOT_INSET = 2.5;
const ROBOT_R = 0.27;
const CARRY_R = 0.42;

/**
 * Reads --ink, --bg, --accent from CSS custom properties on `el`
 * (default: the root element), falling back to the design tokens.
 */
export function readColors(el: Element = document.documentElement): Colors {
  const css = getComputedStyle(el);
  const pick = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ink: pick('--ink', DEFAULT_COLORS.ink),
    bg: pick('--bg', DEFAULT_COLORS.bg),
    accent: pick('--accent', DEFAULT_COLORS.accent),
  };
}

/**
 * Sizes the canvas to fit its parent element while keeping the layout's aspect
 * ratio. CSS size = grid × cell; backing size = CSS size × devicePixelRatio;
 * the context is scaled so drawing uses CSS pixels.
 */
export function fitCanvas(canvas: HTMLCanvasElement, layout: Layout): { cell: number; dpr: number } {
  const dpr = window.devicePixelRatio || 1;
  const box = canvas.parentElement ?? canvas;
  const cw = box.clientWidth;
  const ch = box.clientHeight;
  const byW = cw / layout.width;
  const byH = ch / layout.height;
  // A container without a definite height constrains by width only.
  const cell = Math.max(1, ch > 0 ? Math.min(byW, byH) : byW);
  const cssW = layout.width * cell;
  const cssH = layout.height * cell;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cell, dpr };
}

/** Cell size in CSS pixels, derived from the canvas and the context scale set by fitCanvas. */
function cellOf(ctx: CanvasRenderingContext2D, layout: Layout): number {
  const scale = ctx.getTransform().a || 1;
  return ctx.canvas.width / scale / layout.width;
}

function drawWalls(ctx: CanvasRenderingContext2D, layout: Layout, cell: number, ink: string): void {
  const { width, height, kinds } = layout;
  ctx.beginPath();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const wall = kinds[i] === CellKind.Wall;
      const x0 = x * cell;
      const y0 = y * cell;
      const x1 = x0 + cell;
      const y1 = y0 + cell;
      // East and south edges between this cell and its neighbor: draw when exactly one is a wall.
      if (x + 1 < width && wall !== (kinds[i + 1] === CellKind.Wall)) {
        ctx.moveTo(x1, y0);
        ctx.lineTo(x1, y1);
      }
      if (y + 1 < height && wall !== (kinds[i + width] === CellKind.Wall)) {
        ctx.moveTo(x0, y1);
        ctx.lineTo(x1, y1);
      }
      // Grid boundary edges of non-wall cells.
      if (!wall) {
        if (x === 0) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0, y1);
        }
        if (x === width - 1) {
          ctx.moveTo(x1, y0);
          ctx.lineTo(x1, y1);
        }
        if (y === 0) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y0);
        }
        if (y === height - 1) {
          ctx.moveTo(x0, y1);
          ctx.lineTo(x1, y1);
        }
      }
    }
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = WALL_WIDTH;
  ctx.lineCap = 'square';
  ctx.stroke();
}

function drawEndpoints(ctx: CanvasRenderingContext2D, layout: Layout, cell: number, c: Colors): void {
  const { width, pods, chargers, stations } = layout;
  const side = Math.max(0, cell - 2 * SLOT_INSET);

  // Pod slots and chargers: hollow 1px squares, inset 2.5px.
  ctx.beginPath();
  for (let k = 0; k < pods.length; k++) {
    const i = pods[k];
    ctx.rect((i % width) * cell + SLOT_INSET, Math.floor(i / width) * cell + SLOT_INSET, side, side);
  }
  const arm = cell * 0.16;
  for (let k = 0; k < chargers.length; k++) {
    const i = chargers[k];
    const x0 = (i % width) * cell;
    const y0 = Math.floor(i / width) * cell;
    ctx.rect(x0 + SLOT_INSET, y0 + SLOT_INSET, side, side);
    const cx = x0 + cell / 2;
    const cy = y0 + cell / 2;
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
  }
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.stroke();

  // Stations: solid squares with the station number (index + 1) in mono.
  ctx.font = `${Math.max(6, Math.round(cell * 0.5))}px 'Geist Mono', ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let s = 0; s < stations.length; s++) {
    const i = stations[s];
    const x0 = (i % width) * cell;
    const y0 = Math.floor(i / width) * cell;
    ctx.fillStyle = c.ink;
    ctx.fillRect(x0, y0, cell, cell);
    ctx.fillStyle = c.bg;
    ctx.fillText(String(s + 1), x0 + cell / 2, y0 + cell / 2 + 0.5);
  }
}

function drawRobots(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  rec: Recording,
  tick: number,
  cell: number,
  ink: string,
): void {
  const pos = positionsAt(rec, tick);
  const st = statesAt(rec, tick);
  const w = layout.width;

  ctx.beginPath();
  for (let r = 0; r < rec.robots; r++) {
    const cx = ((pos[r] % w) + 0.5) * cell;
    const cy = (Math.floor(pos[r] / w) + 0.5) * cell;
    ctx.moveTo(cx + ROBOT_R * cell, cy);
    ctx.arc(cx, cy, ROBOT_R * cell, 0, Math.PI * 2);
  }
  ctx.fillStyle = ink;
  ctx.fill();

  // Carrying a pod: to-station, serving, returning.
  ctx.beginPath();
  for (let r = 0; r < rec.robots; r++) {
    const s = st[r];
    if (s !== RState.ToStation && s !== RState.Serving && s !== RState.Returning) continue;
    const cx = ((pos[r] % w) + 0.5) * cell;
    const cy = (Math.floor(pos[r] / w) + 0.5) * cell;
    ctx.moveTo(cx + CARRY_R * cell, cy);
    ctx.arc(cx, cy, CARRY_R * cell, 0, Math.PI * 2);
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * Draws the full frame at `tick` (must be in [0, rec.frames)). Expects the
 * context scaled by fitCanvas. Trails, congestion, and stall overlays are
 * accepted but not drawn yet (task 9).
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  rec: Recording,
  tick: number,
  opts: DrawOptions,
): void {
  const c = opts.colors ?? DEFAULT_COLORS;
  const cell = cellOf(ctx, layout);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, layout.width * cell, layout.height * cell);
  drawWalls(ctx, layout, cell, c.ink);
  drawEndpoints(ctx, layout, cell, c);
  drawRobots(ctx, layout, rec, tick, cell, c.ink);
}
