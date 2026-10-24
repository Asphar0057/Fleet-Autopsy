// Pure helpers for inline SVG polylines (sparkline, scrubber throughput line). No DOM.

/**
 * SVG `points` for values[0..count) in a `w` × `h` viewBox, x spanning `xSpan`
 * samples (default count - 1) and y spanning 0..maxY (bottom to top).
 * Downsamples to at most `maxPoints` points, always keeping the last value.
 */
export function polylinePoints(
  values: ArrayLike<number>,
  count: number,
  w: number,
  h: number,
  maxY: number,
  maxPoints = 200,
  xSpan = count - 1,
): string {
  if (count <= 0) return '';
  const sx = xSpan > 0 ? w / xSpan : 0;
  const sy = maxY > 0 ? h / maxY : 0;
  const step = Math.max(1, Math.ceil(count / maxPoints));
  const parts: string[] = [];
  const add = (i: number) => parts.push(`${round(i * sx)},${round(h - values[i] * sy)}`);
  for (let i = 0; i < count; i += step) add(i);
  if ((count - 1) % step !== 0) add(count - 1);
  return parts.join(' ');
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Maximum of values[0..count), or 0 when empty. */
export function maxOf(values: ArrayLike<number>, count = values.length): number {
  let m = 0;
  for (let i = 0; i < count; i++) if (values[i] > m) m = values[i];
  return m;
}
