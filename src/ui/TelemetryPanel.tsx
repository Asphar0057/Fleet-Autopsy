// Panel section 03 TELEMETRY (Requirement 9.1 to 9.3): jam badge, the disabled
// "Find the cause" button (Spec 3 seam), throughput sparkline with the detected
// onset in accent, stalled count, and per-station queue bars.
import { useMemo } from 'react';
import type { Jam } from '../sim/jam';
import { STANDSTILL_SHORT } from '../sim/telemetry';
import { stationLabel } from '../render/labels';
import { jamBadgeText } from './jamBadge';
import { maxOf, polylinePoints } from './sparkline';

const SPARK_W = 240;
const SPARK_H = 64;

/** Copy of the tracker output that React keeps (the tracker overwrites its arrays). */
export interface TelemetryView {
  /** Tick the telemetry and detection cover. */
  upTo: number;
  /** Throughput over 0..upTo (jamWindow deliveries). */
  throughput: Int16Array;
  /** Robots with standstill >= 20 at upTo. */
  stalled20: number;
  /** Queue length per station at upTo. */
  queues: number[];
  jam: Jam | null;
}

export function JamBadge({ jam }: { jam: Jam | null }) {
  const b = jamBadgeText(jam);
  return (
    <>
      <p className={b.alert ? 'badge badge--alert' : 'badge'}>{b.text}</p>
      {/* Announce state changes only, not every severity update. */}
      <span className="sr-only" role="status">
        {jam ? `jam detected, onset tick ${jam.onsetTick}` : 'healthy'}
      </span>
    </>
  );
}

export interface TelemetryPanelProps {
  view: TelemetryView | null;
  queueCap: number;
}

export function TelemetryPanel({ view, queueCap }: TelemetryPanelProps) {
  const spark = useMemo(() => {
    if (!view) return null;
    const n = view.throughput.length;
    const top = Math.max(1, maxOf(view.throughput));
    const points = polylinePoints(view.throughput, n, SPARK_W, SPARK_H - 2, top, 120, view.upTo);
    const onset = view.jam ? (view.upTo > 0 ? (view.jam.onsetTick / view.upTo) * SPARK_W : 0) : null;
    return { points, onset };
  }, [view]);

  return (
    <section className="section">
      <h2 className="label">03&nbsp;&nbsp;TELEMETRY</h2>
      <JamBadge jam={view ? view.jam : null} />
      <div className="find-cause">
        <button type="button" className="btn btn--primary" disabled aria-describedby="find-cause-note">
          Find the cause
        </button>
        <p id="find-cause-note" className="note">
          available in the next step
        </p>
      </div>
      {view && spark ? (
        <>
          <svg
            className="sparkline"
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={
              `telemetry throughput over ticks 0 to ${view.upTo}` +
              (view.jam ? `, jam onset at tick ${view.jam.onsetTick}` : '')
            }
          >
            <line
              x1={0}
              x2={SPARK_W}
              y1={SPARK_H - 1}
              y2={SPARK_H - 1}
              stroke="var(--line-soft, rgba(0,0,0,.14))"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={spark.points}
              transform="translate(0 1)"
              fill="none"
              stroke="var(--ink, #000)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {spark.onset !== null && (
              <line
                className="onset-marker"
                x1={spark.onset}
                x2={spark.onset}
                y1={0}
                y2={SPARK_H}
                stroke="var(--accent, #ff4a1c)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <dl className="metrics telemetry-metrics">
            <div className="metric">
              <dt className="label">stalled ≥ {STANDSTILL_SHORT} ticks</dt>
              <dd className="mono value">{view.stalled20}</dd>
            </div>
          </dl>
          <ul className="queues mono" aria-label="station queues">
            {view.queues.map((q, s) => (
              <li key={s} className="queue">
                <span className="label">{stationLabel(s)}</span>
                <span className="qbar" aria-hidden="true">
                  <span
                    className="qbar-fill"
                    style={{ width: `${queueCap > 0 ? Math.min(100, (q / queueCap) * 100) : 0}%` }}
                  />
                </span>
                <span className="value">
                  {q}/{queueCap}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mono muted telemetry-empty">no data</p>
      )}
    </section>
  );
}
