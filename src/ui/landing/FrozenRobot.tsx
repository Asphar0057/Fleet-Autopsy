// Landing effect: one frozen robot (white dot) with an accent glow and ring
// ripples, and a few robots drifting toward it. CSS animations only (transform
// and opacity); every position is a hardcoded constant, so renders are stable.
import type { CSSProperties } from 'react';

const RINGS = 7;

/** Drifting robots: direction from the frozen robot (deg, 0 = right, -90 = up), start distance, size, opacity, duration, delay (s). */
const DRIFTERS: readonly { a: number; d: number; s: number; o: number; t: number; k: number }[] = [
  { a: -96, d: 300, s: 4, o: 0.6, t: 11, k: 0 },
  { a: -78, d: 420, s: 3, o: 0.45, t: 13, k: -4.2 },
  { a: -62, d: 360, s: 5, o: 0.7, t: 10, k: -2.1 },
  { a: -46, d: 480, s: 3, o: 0.4, t: 14, k: -7.5 },
  { a: -32, d: 340, s: 4, o: 0.55, t: 12, k: -5.4 },
  { a: -18, d: 460, s: 3, o: 0.5, t: 13.5, k: -9.8 },
  { a: -6, d: 380, s: 5, o: 0.65, t: 11.5, k: -1.3 },
  { a: 8, d: 520, s: 3, o: 0.4, t: 15, k: -11.2 },
  { a: 18, d: 300, s: 4, o: 0.5, t: 10.5, k: -6.6 },
];

export function FrozenRobot() {
  return (
    <div className="frozen-robot" aria-hidden="true">
      <span className="fr-glow" />
      {Array.from({ length: RINGS }, (_, i) => (
        <span key={i} className="fr-ring" style={{ '--r': i } as CSSProperties} />
      ))}
      {DRIFTERS.map((p, i) => (
        <span key={i} className="fr-drift" style={{ '--a': `${p.a}deg` } as CSSProperties}>
          <span
            className="fr-dot"
            style={
              {
                '--d': `${p.d}px`,
                '--s': `${p.s}px`,
                '--o': p.o,
                '--t': `${p.t}s`,
                '--k': `${p.k}s`,
              } as CSSProperties
            }
          />
        </span>
      ))}
      <span className="fr-core" />
    </div>
  );
}
