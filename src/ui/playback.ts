// Playback model (design.md D10). Pure apart from calling sim.step().
// The playhead reads the Recording; it never exceeds sim.tick. Stepping forward
// at the end of the Recording advances the Sim by one tick.

export const BASE_TICKS_PER_SECOND = 10;
export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

export interface Steppable {
  readonly tick: number;
  step(): void;
}

/** Next playhead: within the Recording it just advances; at the end it steps the Sim. */
export function stepForward(sim: Steppable, playhead: number): number {
  if (playhead < sim.tick) return playhead + 1;
  sim.step();
  return sim.tick;
}

export function stepBack(playhead: number): number {
  return Math.max(0, playhead - 1);
}

/** Clamps a requested playhead into the recorded range [0, sim.tick]. */
export function clampPlayhead(sim: Steppable, playhead: number): number {
  return Math.min(Math.max(0, Math.round(playhead)), sim.tick);
}

/** Milliseconds per tick at a playback speed. */
export function tickInterval(speed: number): number {
  return 1000 / (BASE_TICKS_PER_SECOND * speed);
}

/** Header meta number: zero-padded to 4 digits (`0042`), longer numbers unchanged. */
export function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
