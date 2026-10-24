// Right-hand panel (Requirement 6.5, 6.6, 7.5, 9.6, 9.9): verifier badge,
// metrics at the playhead with a throughput sparkline, station queues, assumptions.
import { useMemo } from 'react';
import type { Layout } from '../sim/layout';
import { meanCycleTime, queueLengths, THROUGHPUT_WINDOW } from '../sim/metrics';
import type { Recording } from '../sim/recorder';
import type { Badge } from './badge';
import { maxOf, polylinePoints } from './sparkline';

const SPARK_W = 240;
const SPARK_H = 40;

const ASSUMPTIONS = [
  'validated in simulation only',
  'inspired by fulfillment-center drive-unit systems; no affiliation with any company',
  'discrete ticks; each robot stays or moves one cell (4-neighborhood)',
  'service takes 8–14 ticks, drawn from the seeded rng',
  'one robot at a station and its access cell at a time',
  'chargers drawn, unused in this version (no battery model)',
  `throughput = deliveries in the last ${THROUGHPUT_WINDOW} ticks`,
];

export interface PanelProps {
  layout: Layout | null;
  rec: Recording | null;
  playhead: number;
  /** Recorded frames; with playhead, triggers recomputation (rec is mutated in place). */
  frames: number;
  /** throughputSeries over 0..frames-1; its prefix up to the playhead is the series at the playhead. */
  series: Int16Array;
  badge: Badge | null;
  error: string | null;
}

export function Panel({ layout, rec, playhead, frames, series, badge, error }: PanelProps) {
  const ready = rec !== null && playhead < frames && playhead < rec.frames;

  const metrics = useMemo(() => {
    if (!rec || !ready) return null;
    const cycle = meanCycleTime(rec, playhead);
    const n = Math.min(series.length, playhead + 1);
    const spark = polylinePoints(series, n, SPARK_W, SPARK_H - 2, Math.max(1, maxOf(series)), 120, playhead);
    return {
      throughput: playhead < series.length ? series[playhead] : 0,
      cycle,
      spark,
      queues: Array.from(queueLengths(rec, playhead)),
    };
  }, [rec, ready, playhead, series]);

  return (
    <aside className="panel" aria-label="run details">
      {error !== null && (
        <section className="section">
          <h2 className="label">ERROR</h2>
          <pre className="mono error" role="alert">
            {error}
          </pre>
        </section>
      )}
      <section className="section">
        <h2 className="label">01&nbsp;&nbsp;VERIFIER</h2>
        {badge ? (
          <p className={badge.alert ? 'badge badge--alert' : 'badge'} role="status">
            {badge.text}
          </p>
        ) : (
          <p className="mono muted">verifying</p>
        )}
      </section>

      <section className="section">
        <h2 className="label">02&nbsp;&nbsp;METRICS</h2>
        {metrics ? (
          <>
            <dl className="metrics">
              <div className="metric">
                <dt className="label">throughput</dt>
                <dd className="mono value">
                  {metrics.throughput} <span className="unit">deliveries / {THROUGHPUT_WINDOW} ticks</span>
                </dd>
              </div>
              <div className="metric">
                <dt className="label">mean cycle time</dt>
                <dd className="mono value">
                  {Number.isNaN(metrics.cycle) ? 'n/a' : metrics.cycle.toFixed(1)} <span className="unit">ticks</span>
                </dd>
              </div>
            </dl>
            <svg
              className="sparkline"
              viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`throughput over ticks 0 to ${playhead}`}
            >
              <polyline
                points={metrics.spark}
                fill="none"
                stroke="var(--ink, #000)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </>
        ) : (
          <p className="mono muted">no data</p>
        )}
      </section>

      <section className="section">
        <h2 className="label">03&nbsp;&nbsp;STATIONS</h2>
        {metrics && layout ? (
          <table className="stations mono">
            <thead>
              <tr>
                <th scope="col" className="label">station</th>
                <th scope="col" className="label">queue</th>
              </tr>
            </thead>
            <tbody>
              {metrics.queues.map((q, s) => (
                <tr key={s}>
                  <td>{String(s + 1).padStart(2, '0')}</td>
                  <td>{q}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mono muted">no data</p>
        )}
      </section>

      <section className="section">
        <h2 className="label">04&nbsp;&nbsp;ASSUMPTIONS</h2>
        <ul className="assumptions">
          {ASSUMPTIONS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
