// Pure label helpers shared by the canvas renderer and the panel. No DOM.

/** Station label for station index `s` (0-based): index + 1, zero-padded to 2 ("01", "02", ...). */
export function stationLabel(s: number): string {
  return String(s + 1).padStart(2, '0');
}

export const STATION_FONT_RATIO = 0.55;
export const STATION_FONT_MIN = 7;
export const STATION_TEXT_FIT = 0.8;

/**
 * Station label font size in CSS px: about 0.55 cell, at least 7px, then scaled
 * down so the text fits within 0.8 cell. `widthAt(px)` returns the label width
 * at that font size; text width is linear in font size, so one measurement is enough.
 */
export function stationFontSize(cell: number, widthAt: (px: number) => number): number {
  const size = Math.max(STATION_FONT_MIN, cell * STATION_FONT_RATIO);
  const w = widthAt(size);
  const max = cell * STATION_TEXT_FIT;
  return w > max && w > 0 ? (size * max) / w : size;
}

/** At most this many Stall_Labels per frame; more stalled robots show a count chip. */
export const MAX_STALL_LABELS = 4;

/**
 * Writes into out[0..min(total, MAX_STALL_LABELS)) the lowest ids r, ascending, with
 * stalled[r] === 1 and skip?.[r] !== 1. Returns total, the count of all such robots.
 * No allocation; `out` must have length >= MAX_STALL_LABELS.
 */
export function stallLabels(stalled: Uint8Array, skip: Uint8Array | null, out: Int16Array): number {
  let total = 0;
  for (let r = 0; r < stalled.length; r++) {
    if (stalled[r] !== 1) continue;
    if (skip !== null && skip[r] === 1) continue;
    if (total < MAX_STALL_LABELS) out[total] = r;
    total++;
  }
  return total;
}
