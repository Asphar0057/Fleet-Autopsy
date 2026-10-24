// Telemetry section (Requirement 3.1 to 3.5; Spec 2 9.1 to 9.3): jam status with a
// polite live region, the disabled "Find the cause" button (Spec 3 seam), the one
// throughput sparkline with the detected onset in Accent, the stalled count, and
// per-station queue bars. Rendered as one card of the run-details grid; the
// Stations disclosure arrives as children.
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Jam } from '../sim/jam';
import { STANDSTILL_SHORT } from '../sim/telemetry';
import { stationLabel } from '../render/labels';
import { CARD_TITLES, jamAnnouncement, jamCopy, SECTION_NOTES, TERMS } from './copy';
import { InfoTip } from './InfoTip';
import { SectionHead } from './SectionHead';
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

/** Jam status line (Accent only when a jam is detected) plus a polite live region. */
export function JamBadge({ jam }: { jam: Jam | null }) {
  const b = jamCopy(jam);
  return (
    <div className="status-row">
      <p className={b.alert ? 'badge badge--alert' : 'badge'}>{b.text}</p>
      {jam !== null && (
        <span className="status-tips">
          <InfoTip label="onset" text={TERMS.onset} />
          <InfoTip label="severity" text={TERMS.severity} />
        </span>
      )}
      {/* Announce state changes only, not every severity update. */}
      <span className="sr-only" role="status" aria-live="polite">
        {jamAnnouncement(jam)}
      </span>
    </div>
  );
}

export interface TelemetryPanelProps {
  view: TelemetryView | null;
  queueCap: number;
  /** Rendered at the end of the card, after the queue bars (the Stations disclosure). */
  children?: ReactNode;
}

export function TelemetryPanel({ view, queueCap, children }: TelemetryPanelProps) {
  const spark = useMemo(() => {
    if (!view) return null;
    const n = view.throughput.length;
    const top = Math.max(1, maxOf(view.throughput));
    const points = polylinePoints(view.throughput, n, SPARK_W, SPARK_H - 2, top, 120, view.upTo);
    const onset = view.jam ? (view.upTo > 0 ? (view.jam.onsetTick / view.upTo) * SPARK_W : 0) : null;
    return { points, onset };
  }, [view]);

  return (
    <section className="card">
      <SectionHead title={CARD_TITLES[2]} note={SECTION_NOTES.telemetry} />
      <JamBadge jam={view ? view.jam : null} />
      <div className="find-cause">
        <button type="button" className="btn btn--primary" disabled aria-describedby="find-cause-note">
          Find the cause
        </button>
        <p id="find-cause-note" className="note">
          Coming in the next step
        </p>
      </div>
      {view && spark ? (
        <>
          <p className="label spark-label">
            Throughput <InfoTip label="throughput" text={TERMS.throughput} />
          </p>
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
              stroke="var(--hairline, rgba(255,255,255,.10))"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={spark.points}
              transform="translate(0 1)"
              fill="none"
              stroke="var(--fg, #ffffff)"
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
              <dt className="label">
                Stalled ≥ {STANDSTILL_SHORT} ticks <InfoTip label="stalled" text={TERMS.stalled} />
              </dt>
              <dd className="mono value">{view.stalled20}</dd>
            </div>
          </dl>
          <ul className="queues" aria-label="station queues">
            {view.queues.map((q, s) => (
              <li key={s} className="queue">
                <span className="label">Station {stationLabel(s)}</span>
                <span className="qbar" aria-hidden="true">
                  <span
                    className="qbar-fill"
                    style={{ width: `${queueCap > 0 ? Math.min(100, (q / queueCap) * 100) : 0}%` }}
                  />
                </span>
                <span className="mono value">
                  {q}/{queueCap}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted telemetry-empty">No data yet</p>
      )}
      {children}
    </section>
  );
}
