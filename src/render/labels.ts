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
