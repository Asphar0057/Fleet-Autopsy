// Landing jam scene: a frozen robot with an accent glow and fading ripples;
// ten robots drive in along straight lines, slow down, and stop as grey-ringed
// stalled robots in a loose cluster around it. Deterministic: every position and
// time is a constant below. CSS transform/opacity animations; one short timer
// list drives the "n stalled" counter. Times are seconds from page mount.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

/** Grid pitch of the parking cells around the frozen robot (px). */
const CELL = 40;
/** The frozen robot fades in here; the first ripple fires with it. */
export const FROZEN_AT = 1.4;
const RINGS = 7;
const RING_GAP = 1;
/** The counter appears once this many robots have stalled. */
const COUNT_FROM = 3;

/** Parking cell (grid units from the frozen robot), start offset (px), arrival and travel time (s). */
const ROBOTS: readonly { cx: number; cy: number; sx: number; sy: number; at: number; dur: number }[] = [
  { cx: 1, cy: -1, sx: 420, sy: -160, at: 1.8, dur: 1.6 },
  { cx: 0, cy: -2, sx: 60, sy: -330, at: 2.5, dur: 2.0 },
  { cx: 2, cy: 0, sx: 480, sy: 30, at: 3.2, dur: 2.4 },
  { cx: -1, cy: -1, sx: -120, sy: -320, at: 3.9, dur: 2.6 },
  { cx: 2, cy: -1, sx: 460, sy: -260, at: 4.6, dur: 2.8 },
  { cx: 0, cy: 1, sx: 440, sy: 110, at: 5.3, dur: 3.0 },
  { cx: -2, cy: -1, sx: -260, sy: -300, at: 6.0, dur: 3.0 },
  { cx: 1, cy: 2, sx: 420, sy: 140, at: 6.8, dur: 3.2 },
  { cx: 0, cy: 2, sx: 380, sy: 150, at: 7.6, dur: 3.4 },
  { cx: -1, cy: 2, sx: 360, sy: 160, at: 8.5, dur: 3.6 },
];

/** Precomputed per robot: parking point (px) and trail angle (pointing back toward the start). */
const PLACED = ROBOTS.map((r) => {
  const px = r.cx * CELL;
  const py = r.cy * CELL;
  const angle = (Math.atan2(r.sy - py, r.sx - px) * 180) / Math.PI;
  return { ...r, px, py, angle, start: Math.max(0.1, r.at - r.dur) };
});

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Robots stalled so far; jumps to all of them under reduced motion. */
function useStalledCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reducedMotion()) {
      setN(ROBOTS.length);
      return;
    }
    const timers = ROBOTS.map((r, i) => window.setTimeout(() => setN(i + 1), r.at * 1000));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  return n;
}

export function JamScene() {
  const stalled = useStalledCount();
  return (
    <div className="jam-scene" aria-hidden="true">
      <div className="jam-centre">
        <span className="jam-glow" />
        {Array.from({ length: RINGS }, (_, i) => (
          <span key={i} className="jam-ring" style={{ '--k': `${FROZEN_AT + i * RING_GAP}s` } as CSSProperties} />
        ))}
        {PLACED.map((r, i) => (
          <span
            key={i}
            className="jam-robot"
            style={
              {
                '--sx': `${r.sx}px`,
                '--sy': `${r.sy}px`,
                '--px': `${r.px}px`,
                '--py': `${r.py}px`,
                '--start': `${r.start}s`,
                '--dur': `${r.at - r.start}s`,
                '--at': `${r.at}s`,
              } as CSSProperties
            }
          >
            <span className="jam-trail" style={{ transform: `rotate(${r.angle.toFixed(1)}deg)` }} />
            <span className="jam-dot" />
            <span className="stalled" />
          </span>
        ))}
        <span className="jam-frozen" style={{ '--k': `${FROZEN_AT}s` } as CSSProperties} />
        <span className={stalled >= COUNT_FROM ? 'jam-count jam-count--on' : 'jam-count'}>
          {Math.max(stalled, COUNT_FROM)} stalled
        </span>
      </div>
    </div>
  );
}
