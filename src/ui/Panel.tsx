// Run details under the canvas (visual-polish Requirement 4; Spec 1 6.5, 6.6, 7.5):
// four cards in a grid: verifier badge, metrics at the playhead, telemetry and jam
// status (with the station table in a "Stations" disclosure), assumptions. Each
// card has a title and one grey sentence saying what it shows. An error card
// spans all columns above them.
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Layout } from '../sim/layout';
import { meanCycleTime, queueLengths, THROUGHPUT_WINDOW } from '../sim/metrics';
import type { Recording } from '../sim/recorder';
import { stationLabel } from '../render/labels';
import type { Badge } from './badge';
import { CARD_TITLES, SECTION_NOTES, TERMS } from './copy';
import { InfoTip } from './InfoTip';
import { SectionHead } from './SectionHead';
import { TelemetryPanel } from './TelemetryPanel';
import type { TelemetryView } from './TelemetryPanel';

const ASSUMPTIONS = [
  'simulation only; results are not validated on real fleets',
  'faults are injected with known ground truth',
  'detection thresholds are fixed and were not tuned on the evaluation scenarios beyond the healthy baselines',
  'inspired by fulfillment-center drive-unit systems; no affiliation with any company',
  'discrete ticks; each robot stays or moves one cell (4-neighborhood)',
  'service takes 8–14 ticks, drawn from the seeded rng',
  'one robot at a station and its access cell at a time',
  'battery and charging cut on purpose; chargers are drawn and unused',
  `throughput = deliveries in the last ${THROUGHPUT_WINDOW} ticks`,
];

export interface PanelProps {
  layout: Layout | null;
  rec: Recording | null;
  playhead: number;
  /** Recorded frames; with playhead, triggers recomputation (rec is mutated in place). */
  frames: number;
  /** throughputSeries over 0..frames-1; its value at the playhead is the throughput shown. */
  series: Int16Array;
  badge: Badge | null;
  /** Telemetry and jam detection, published about 4 times a second. */
  telemetry: TelemetryView | null;
  error: string | null;
  /** "Find the cause" block for the Telemetry card. */
  findCause?: ReactNode;
}

export function Panel({ layout, rec, playhead, frames, series, badge, telemetry, error, findCause }: PanelProps) {
  const ready = rec !== null && playhead < frames && playhead < rec.frames;

  const metrics = useMemo(() => {
    if (!rec || !ready) return null;
    return {
      throughput: playhead < series.length ? series[playhead] : 0,
      cycle: meanCycleTime(rec, playhead),
      queues: Array.from(queueLengths(rec, playhead)),
    };
  }, [rec, ready, playhead, series]);

  return (
    <aside className="panel cards" aria-label="run details">
      {error !== null && (
        <section className="card card--wide">
          <SectionHead title="Error" />
          <pre className="mono error" role="alert">
            {error}
          </pre>
        </section>
      )}
      <section className="card">
        <SectionHead title={CARD_TITLES[0]} note={SECTION_NOTES.verifier} />
        {badge ? (
          // Violations are errors, not the jam: a white border, never Accent (Accent rules).
          <p className={badge.alert ? 'badge badge--strong' : 'badge'} role="status">
            {badge.text}
          </p>
        ) : (
          <p className="muted">Verifying</p>
        )}
      </section>

      <section className="card">
        <SectionHead title={CARD_TITLES[1]} note={SECTION_NOTES.metrics} />
        {metrics ? (
          <dl className="bignums">
            <div className="bignum">
              <dt className="label">
                Throughput <InfoTip label="throughput" text={TERMS.throughput} />
              </dt>
              <dd>
                <span className="num">{metrics.throughput}</span>{' '}
                <span className="unit">deliveries / {THROUGHPUT_WINDOW} ticks</span>
              </dd>
            </div>
            <div className="bignum">
              <dt className="label">Mean cycle time</dt>
              <dd>
                <span className="num">{Number.isNaN(metrics.cycle) ? 'n/a' : metrics.cycle.toFixed(1)}</span>{' '}
                <span className="unit">ticks</span>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="muted">No data yet</p>
        )}
      </section>

      <TelemetryPanel view={telemetry} queueCap={layout ? layout.queueCap : 0} findCause={findCause}>
        <details className="disclosure">
          <summary className="disclosure-summary">Stations</summary>
          <p className="section-note">{SECTION_NOTES.stations}</p>
          {metrics && layout ? (
            <table className="stations">
              <thead>
                <tr>
                  <th scope="col">Station</th>
                  <th scope="col">Pods waiting</th>
                </tr>
              </thead>
              <tbody>
                {metrics.queues.map((q, s) => (
                  <tr key={s}>
                    <td>
                      Station <span className="mono">{stationLabel(s)}</span>
                    </td>
                    <td className="mono">{q}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No data yet</p>
          )}
        </details>
      </TelemetryPanel>

      <section className="card">
        <SectionHead title={CARD_TITLES[3]} note={SECTION_NOTES.assumptions} />
        <ul className="assumptions">
          {ASSUMPTIONS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
