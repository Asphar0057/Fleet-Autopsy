// Verifier badge text (Requirements 6.5, 6.6). Pure, no DOM.

export interface Badge {
  text: string;
  /** True when the run has violations; the badge then uses the accent color. */
  alert: boolean;
}

/**
 * `violations` is the violation count from `verifyRun`. `ticks` is the number
 * of completed ticks in the recording, i.e. `sim.tick` (= `recording.frames - 1`,
 * since frame 0 is the spawn state before any tick).
 */
export function badgeText(violations: number, ticks: number): Badge {
  if (violations === 0) return { text: `VERIFIED · 0 VIOLATIONS · ${ticks} TICKS`, alert: false };
  const noun = violations === 1 ? 'VIOLATION' : 'VIOLATIONS';
  return { text: `${violations} ${noun} · ${ticks} TICKS`, alert: true };
}
