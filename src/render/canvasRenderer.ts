// Canvas 2D renderer, dark instrument style (steering design.md, canvas drawing rules).
// Stateless: every call draws a full frame from the Layout and the Recording.
// Imports sim types and pure read helpers only.

import type { Layout } from '../sim/layout';
import { positionsAt, statesAt } from '../sim/recorder';
import type { Recording } from '../sim/recorder';
import { CellKind, RState } from '../sim/types';
import { MAX_STALL_LABELS, stallLabels, stationFontSize, stationLabel } from './labels';
import type { RevealMarks } from './marks';

export type { RevealMark, RevealMarks } from './marks';

export interface Colors {
  bg: string;
  robot: string;
  carry: string;
  wall: string;
  pod: string;
  station: string;
  stationText: string;
  stall: string;
  label: string;
  /** Reveal markers only (steering design.md, Accent rules). */
  accent: string;
  /** Kept for callers that still read it; equals robot. */
  ink: string;
}

export interface DrawOptions {
  trails: boolean;
  congestion: boolean;
  /** Per-cell wait counts at `tick` (createWaitCounter); hatching needs it. */
  waitCounts: Uint16Array | null;
  /** 1 per stalled robot at `tick` (stalledAt). */
  stalled: Uint8Array;
  /** 1 per cell that is an Engaged_Block at `tick` (blockedAt); drawn in ink, always (D21). */
  blocked: Uint8Array | null;
  /** Ground-truth markers, drawn in accent only when revealed (D21); null hides them. */
  reveal: RevealMarks | null;
  /** 1 per robot that has a reveal marker; its stall ring and label are skipped. Null when not revealed. */
  revealSkip?: Uint8Array | null;
  /** Colors read once at mount via `readColors`; defaults to the design tokens. */
  colors?: Colors;
}

/** The black palette from src/styles/tokens.css (--bg, --canvas-*, --accent). */
export const DEFAULT_COLORS: Colors = {
  bg: '#000000',
  robot: '#ffffff',
  carry: 'rgba(255,255,255,.6)',
  wall: 'rgba(255,255,255,.30)',
  pod: 'rgba(255,255,255,.15)',
  station: 'rgba(255,255,255,.92)',
  stationText: '#000000',
  stall: 'rgba(255,255,255,.45)',
  label: '#a3a3a3',
  accent: '#ff4a1c',
  ink: '#ffffff',
};

/** Mirrors --font-sans in tokens.css; canvas text cannot read CSS variables per frame. */
export const CANVAS_FONT = `'Gotham', 'Montserrat', system-ui, sans-serif`;

/**
 * Scratch for stallLabels ids. Module-level but never read across calls: it is
 * fully written before use in each frame, so drawFrame stays allocation-free
 * and stateless in effect (the no-module-state rule covers src/sim only).
 */
const STALL_IDS = new Int16Array(MAX_STALL_LABELS);

const WALL_WIDTH = 1;
const LABEL_PX = 11;
const CHIP_INSET = 8; // count chip offset from the canvas top-left, CSS px
const SLOT_INSET = 2.5;
const ROBOT_R = 0.27;
const CARRY_R = 0.42;
const STALL_R = 0.78;
const TRAIL_TICKS = 12;
const HATCH_WIDTH = 0.6;
const HATCH_LEVELS = 4;
const BLOCK_HATCH_LINES = 3; // per diagonal direction
const REVEAL_OUTSET = 1.5; // accent square sits just outside the cell

/**
 * Reads --bg, --canvas-*, and --accent from CSS custom properties on `el`
 * (default: the root element), falling back to the black palette.
 */
export function readColors(el: Element = document.documentElement): Colors {
  const css = getComputedStyle(el);
  const pick = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const robot = pick('--canvas-robot', DEFAULT_COLORS.robot);
  return {
    bg: pick('--bg', DEFAULT_COLORS.bg),
    robot,
    carry: pick('--canvas-carry', DEFAULT_COLORS.carry),
    wall: pick('--canvas-wall', DEFAULT_COLORS.wall),
    pod: pick('--canvas-pod', DEFAULT_COLORS.pod),
    station: pick('--canvas-station', DEFAULT_COLORS.station),
    stationText: pick('--canvas-station-text', DEFAULT_COLORS.stationText),
    stall: pick('--canvas-stall', DEFAULT_COLORS.stall),
    label: pick('--canvas-label', DEFAULT_COLORS.label),
    accent: pick('--accent', DEFAULT_COLORS.accent),
    ink: robot,
  };
}

/**
 * Sizes the canvas to fit its parent element while keeping the layout's aspect
 * ratio: cell = min(boxWidth / W, boxHeight / H). CSS size = grid × cell; backing
 * size = CSS size × devicePixelRatio; the context is scaled so drawing uses CSS
 * pixels. The canvas is expected to be absolutely positioned inside the box so
 * its size never feeds back into the box size (no ResizeObserver loop); it is
 * centered horizontally and vertically in the box.
 */
export function fitCanvas(canvas: HTMLCanvasElement, layout: Layout): { cell: number; dpr: number } {
  const dpr = window.devicePixelRatio || 1;
  const box = canvas.parentElement ?? canvas;
  const cw = box.clientWidth;
  const ch = box.clientHeight;
  const byW = cw / layout.width;
  const byH = ch / layout.height;
  // A container without a definite height constrains by width only.
  const cell = Math.max(1, ch >= 1 ? Math.min(byW, byH) : byW);
  const cssW = layout.width * cell;
  const cssH = layout.height * cell;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.left = `${Math.max(0, (cw - cssW) / 2)}px`;
  canvas.style.top = `${ch >= 1 ? Math.max(0, (ch - cssH) / 2) : 0}px`;
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
  ctx.strokeStyle = c.pod;
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.stroke();

  // Stations: filled squares with the two-digit station label ("01".."06") in the sans.
  if (stations.length === 0) return;
  const sample = stationLabel(stations.length - 1); // labels are centred, so small width differences do not show
  const size = stationFontSize(cell, (px) => {
    ctx.font = stationFont(px);
    return ctx.measureText(sample).width;
  });
  ctx.font = stationFont(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Center the digits' ink box vertically (digits have no descender).
  const m = ctx.measureText(sample);
  const ascent = m.actualBoundingBoxAscent || size * 0.7;
  const descent = m.actualBoundingBoxDescent || 0;
  const dy = (ascent - descent) / 2;
  for (let s = 0; s < stations.length; s++) {
    const i = stations[s];
    const x0 = (i % width) * cell;
    const y0 = Math.floor(i / width) * cell;
    ctx.fillStyle = c.station;
    ctx.fillRect(x0, y0, cell, cell);
    ctx.fillStyle = c.stationText;
    ctx.fillText(stationLabel(s), x0 + cell / 2, y0 + cell / 2 + dy);
  }
}

function stationFont(px: number): string {
  return `500 ${Math.round(px * 10) / 10}px ${CANVAS_FONT}`;
}

/** Canvas label font: sans 500 11px, sentence case (constant string, no per-frame allocation). */
const LABEL_FONT = `500 ${LABEL_PX}px ${CANVAS_FONT}`;

function drawRobots(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  rec: Recording,
  tick: number,
  cell: number,
  c: Colors,
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
  ctx.fillStyle = c.robot;
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
  ctx.strokeStyle = c.carry;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * Congestion layer: 45° hatching per floor cell, clipped analytically to the cell.
 * Density is normalized by the maximum count: levels 1..HATCH_LEVELS draw
 * 1, 3, 5, 7 lines. No color, ink only.
 */
function drawCongestion(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  waits: Uint16Array,
  cell: number,
  ink: string,
): void {
  const { width, floor } = layout;
  let max = 0;
  for (let k = 0; k < floor.length; k++) if (waits[floor[k]] > max) max = waits[floor[k]];
  if (max === 0) return;
  ctx.beginPath();
  for (let k = 0; k < floor.length; k++) {
    const i = floor[k];
    const w = waits[i];
    if (w === 0) continue;
    const level = Math.max(1, Math.ceil((HATCH_LEVELS * w) / max));
    const lines = 2 * level - 1;
    const x0 = (i % width) * cell;
    const y0 = Math.floor(i / width) * cell;
    // Lines x + y = s in cell-local coordinates, s evenly spaced in (0, 2 cell).
    for (let j = 1; j <= lines; j++) {
      const s = (2 * cell * j) / (lines + 1);
      const ax = Math.max(0, s - cell);
      const bx = Math.min(cell, s);
      ctx.moveTo(x0 + ax, y0 + s - ax);
      ctx.lineTo(x0 + bx, y0 + s - bx);
    }
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = HATCH_WIDTH;
  ctx.lineCap = 'butt';
  ctx.stroke();
}

/** Trails: the last TRAIL_TICKS moves of each robot, older segments more transparent. */
function drawTrails(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  rec: Recording,
  tick: number,
  cell: number,
  ink: string,
): void {
  const n = rec.robots;
  const w = layout.width;
  const span = Math.min(TRAIL_TICKS, tick);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  // One path per segment age: segment from frame t - 1 to frame t, age = tick - t.
  for (let age = 0; age < span; age++) {
    const t = tick - age;
    const cur = t * n;
    const prev = cur - n;
    ctx.beginPath();
    let any = false;
    for (let r = 0; r < n; r++) {
      const a = rec.positions[prev + r];
      const b = rec.positions[cur + r];
      if (a === b) continue;
      ctx.moveTo(((a % w) + 0.5) * cell, (Math.floor(a / w) + 0.5) * cell);
      ctx.lineTo(((b % w) + 0.5) * cell, (Math.floor(b / w) + 0.5) * cell);
      any = true;
    }
    if (!any) continue;
    ctx.globalAlpha = 1 - age / TRAIL_TICKS;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Stalled robots: a grey 1px ring on every stalled robot without a reveal
 * marker, a sans label `R{id} · stalled` on at most MAX_STALL_LABELS of them
 * (lowest ids first), and a count chip `{n} stalled` top-left when there are more.
 */
function drawStalls(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  rec: Recording,
  tick: number,
  stalled: Uint8Array,
  skip: Uint8Array | null,
  cell: number,
  c: Colors,
): void {
  const pos = positionsAt(rec, tick);
  const w = layout.width;
  const fullW = layout.width * cell;
  const n = Math.min(rec.robots, stalled.length);
  const rr = STALL_R * cell;

  // Rings: one path for all.
  ctx.beginPath();
  let any = false;
  for (let r = 0; r < n; r++) {
    if (stalled[r] !== 1 || (skip !== null && skip[r] === 1)) continue;
    const cx = ((pos[r] % w) + 0.5) * cell;
    const cy = (Math.floor(pos[r] / w) + 0.5) * cell;
    ctx.moveTo(cx + rr, cy);
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    any = true;
  }
  if (!any) return;
  ctx.strokeStyle = c.stall;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Labels: lowest ids first, capped.
  const total = stallLabels(n === stalled.length ? stalled : stalled.subarray(0, n), skip, STALL_IDS);
  const shown = Math.min(total, MAX_STALL_LABELS);
  ctx.fillStyle = c.label;
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'bottom';
  for (let k = 0; k < shown; k++) {
    const r = STALL_IDS[k];
    const cx = ((pos[r] % w) + 0.5) * cell;
    const cy = (Math.floor(pos[r] / w) + 0.5) * cell;
    const label = `R${r} · stalled`;
    const lw = ctx.measureText(label).width;
    // Label to the upper right of the ring; flip left near the right edge.
    const right = cx + rr * 0.7 + lw + 2 <= fullW;
    ctx.textAlign = right ? 'left' : 'right';
    ctx.fillText(label, right ? cx + rr * 0.7 : cx - rr * 0.7, Math.max(LABEL_PX + 1, cy - rr * 0.7));
  }

  // Count chip when more robots are stalled than labelled.
  if (total > MAX_STALL_LABELS) {
    const text = `${total} stalled`;
    const tw = ctx.measureText(text).width;
    const pad = 6;
    const x = CHIP_INSET;
    const y = CHIP_INSET;
    const h = LABEL_PX + 2 * 4;
    ctx.fillStyle = c.bg;
    ctx.fillRect(x, y, tw + 2 * pad, h);
    ctx.strokeStyle = c.stall;
    ctx.strokeRect(x + 0.5, y + 0.5, tw + 2 * pad - 1, h - 1);
    ctx.fillStyle = c.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + pad, y + h / 2);
  }
}

/**
 * Engaged blocks (D21): a 1px ink square inset like a pod slot, cross-hatched
 * on both diagonals with 0.6px lines, so it reads differently from the
 * single-diagonal congestion layer and from an empty pod slot.
 */
function drawBlocked(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  blocked: Uint8Array,
  cell: number,
  ink: string,
): void {
  const { width } = layout;
  const side = Math.max(0, cell - 2 * SLOT_INSET);
  const n = Math.min(blocked.length, layout.kinds.length);
  ctx.strokeStyle = ink;
  ctx.lineCap = 'butt';
  // Pass 0: hatching at 0.6px; pass 1: outlines at 1px.
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < n; i++) {
      if (blocked[i] !== 1) continue;
      any = true;
      const x0 = (i % width) * cell + SLOT_INSET;
      const y0 = Math.floor(i / width) * cell + SLOT_INSET;
      if (pass === 1) {
        ctx.rect(x0, y0, side, side);
        continue;
      }
      // Lines x + y = s ("/") and their mirror x' = side - x ("\"), clipped to the square.
      for (let j = 1; j <= BLOCK_HATCH_LINES; j++) {
        const s = (2 * side * j) / (BLOCK_HATCH_LINES + 1);
        const ax = Math.max(0, s - side);
        const bx = Math.min(side, s);
        ctx.moveTo(x0 + ax, y0 + s - ax);
        ctx.lineTo(x0 + bx, y0 + s - bx);
        ctx.moveTo(x0 + side - ax, y0 + s - ax);
        ctx.lineTo(x0 + side - bx, y0 + s - bx);
      }
    }
    if (!any) return;
    ctx.lineWidth = pass === 0 ? HATCH_WIDTH : 1;
    ctx.stroke();
  }
}

/**
 * Ground-truth markers (D21): a 1px accent square just outside each faulty
 * cell, station, or robot (at its cell at `tick`), with a mono tag above-left
 * (flipped right near the left edge, so it does not collide with the stall
 * label, which sits upper-right).
 */
function drawReveal(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  rec: Recording,
  tick: number,
  marks: RevealMarks,
  cell: number,
  accent: string,
): void {
  if (marks.length === 0) return;
  const pos = positionsAt(rec, tick);
  const w = layout.width;
  const cells = layout.kinds.length;
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'bottom';
  for (const m of marks) {
    let c = -1;
    if (m.target === 'cell') c = m.index;
    else if (m.target === 'station') c = m.index >= 0 && m.index < layout.stations.length ? layout.stations[m.index] : -1;
    else if (m.index >= 0 && m.index < rec.robots) c = pos[m.index];
    if (c < 0 || c >= cells) continue;
    const x0 = (c % w) * cell - REVEAL_OUTSET;
    const y0 = Math.floor(c / w) * cell - REVEAL_OUTSET;
    const side = cell + 2 * REVEAL_OUTSET;
    ctx.strokeRect(x0, y0, side, side);
    const lw = ctx.measureText(m.tag).width;
    const left = x0 - 2 - lw >= 0;
    ctx.textAlign = left ? 'right' : 'left';
    ctx.fillText(m.tag, left ? x0 - 2 : x0 + side + 2, Math.max(LABEL_PX + 1, y0 + 1));
  }
}

/**
 * Draws the full frame at `tick` (must be in [0, rec.frames)). Expects the
 * context scaled by fitCanvas. Layer order: floor structure, congestion,
 * engaged blocks, trails, robots, stalls, ground-truth markers. The accent
 * color is used only for ground-truth markers, when revealed.
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
  if (opts.congestion && opts.waitCounts) drawCongestion(ctx, layout, opts.waitCounts, cell, c.wall);
  drawWalls(ctx, layout, cell, c.wall);
  drawEndpoints(ctx, layout, cell, c);
  if (opts.blocked) drawBlocked(ctx, layout, opts.blocked, cell, c.wall);
  if (opts.trails) drawTrails(ctx, layout, rec, tick, cell, c.robot);
  drawRobots(ctx, layout, rec, tick, cell, c);
  drawStalls(ctx, layout, rec, tick, opts.stalled, opts.revealSkip ?? null, cell, c);
  if (opts.reveal) drawReveal(ctx, layout, rec, tick, opts.reveal, cell, c.accent);
}
