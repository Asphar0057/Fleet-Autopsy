// Scrubber over recorded ticks 0..frames-1 (Requirement 9.2, 9.4), with a 1px
// throughput line and stall event ticks drawn behind the range input.
import { useMemo } from 'react';
import type { Recording } from '../sim/recorder';
import { EKind } from '../sim/types';
import { maxOf, polylinePoints } from './sparkline';

const W = 1000;
const H = 32;

export interface ScrubberProps {
  rec: Recording | null;
  /** Recorded frames (sim.tick + 1); the range spans 0..frames-1. */
  frames: number;
  playhead: number;
  /** throughputSeries over 0..frames-1. */
  series: Int16Array;
  /** Fault start ticks, drawn as accent ticks; pass null unless ground truth is revealed. */
  faultTicks?: readonly number[] | null;
  onSeek(tick: number): void;
}

export function Scrubber({ rec, frames, playhead, series, faultTicks = null, onSeek }: ScrubberProps) {
  const last = Math.max(0, frames - 1);

  const line = useMemo(
    () => polylinePoints(series, Math.min(series.length, frames), W, H - 2, Math.max(1, maxOf(series)), 400, last),
    [series, frames, last],
  );

  // Stall events up to the last recorded frame.
  const stallTicks = useMemo(() => {
    const out: number[] = [];
    if (!rec) return out;
    for (let e = 0; e < rec.events; e++) {
      if (rec.evKind[e] === EKind.Stall && rec.evTick[e] <= last) out.push(rec.evTick[e]);
    }
    return out;
    // `last` triggers a recount as the recording grows (rec is mutated in place).
  }, [rec, last]);

  const x = (t: number) => (last > 0 ? (t / last) * W : 0);

  return (
    <div className="scrubber">
      <svg className="scrubber-track" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {stallTicks.map((t, k) => (
          <line
            key={k}
            className="scrubber-event"
            x1={x(t)}
            x2={x(t)}
            y1={0}
            y2={H}
            stroke="var(--ink, #000)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polyline
          points={line}
          fill="none"
          stroke="var(--ink, #000)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {/* Fault ticks inside the recorded range; later ones appear as the recording reaches them. */}
        {faultTicks?.map((t, k) =>
          t <= last ? (
            <line
              key={`f${k}`}
              className="scrubber-fault"
              x1={x(t)}
              x2={x(t)}
              y1={0}
              y2={H}
              stroke="var(--accent, #ff4a1c)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}
      </svg>
      <input
        className="scrubber-input"
        type="range"
        min={0}
        max={last}
        step={1}
        value={Math.min(playhead, last)}
        aria-label="playhead tick"
        aria-valuetext={`tick ${playhead} of ${last}`}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <div className="scrubber-meta mono">
        <span>0</span>
        <span>
          {stallTicks.length === 0
            ? 'no stall events'
            : `${stallTicks.length} stall ${stallTicks.length === 1 ? 'event' : 'events'}`}
        </span>
        <span>{last}</span>
      </div>
    </div>
  );
}
