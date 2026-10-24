// Autopsy stage (Spec 4), lazy-loaded under the canvas: five steps driven by the
// pure reducer, each with title, caption, and back / next / play buttons. All
// content comes from the autopsy data.
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { drawFrame, fitCanvas, readColors } from '../../render/canvasRenderer';
import type { Layout } from '../../sim/layout';
import { throughputSeries } from '../../sim/metrics';
import { positionsAt } from '../../sim/recorder';
import type { Recording } from '../../sim/recorder';
import type { Scenario } from '../../sim/types';
import { maxOf, polylinePoints } from '../sparkline';
import { autopsyReducer, INITIAL_AUTOPSY, STEP_COUNT } from './autopsyState';
import { baselineRows, faultsWithoutCause, focusTick, stepCopy, suspects } from './model';
import { templateReport } from './report';
import { isAbort, simulateAsync } from './obtain';
import type { AutopsyRun } from './types';
import '../../styles/autopsy.css';

export interface AutopsyStageProps {
  run: AutopsyRun;
  layout: Layout;
  scenario: Scenario | null;
  /** The main canvas recording (observed run) and its shared playhead. */
  observed: Recording | null;
  playhead: number;
  fixActive: boolean;
  onStep(step: number): void;
  onPlayFrom(tick: number): void;
  onToggleFix(): void;
}

interface Replays {
  replay: Recording | null;
  before: Int16Array;
  after: Int16Array;
}

const CURVE_W = 600;
const CURVE_H = 96;

export default function AutopsyStage(p: AutopsyStageProps) {
  const { run, layout, onStep } = p;
  const a = run.data;
  const rc = a.diagnosis.rootCause;
  const [state, dispatch] = useReducer(autopsyReducer, INITIAL_AUTOPSY);
  const [replays, setReplays] = useState<Replays | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => onStep(state.step), [state.step, onStep]);

  // Counterfactual replay and fix curves, sliced so the page stays responsive.
  useEffect(() => {
    const ac = new AbortController();
    const base = { seed: run.world.seed, robots: run.world.robots, queueCap: run.world.queueCap };
    (async () => {
      const replay = rc
        ? await simulateAsync(layout, { ...base, faults: [{ ...rc.fault }] }, a.diagnosis.window.endTick, ac.signal)
        : null;
      const before = await simulateAsync(layout, { ...base, faults: run.world.faults.map((f) => ({ ...f })) }, a.ticks, ac.signal);
      const after = await simulateAsync(layout, { ...base, faults: faultsWithoutCause(a, run.world.faults, layout) }, a.ticks, ac.signal);
      if (!ac.signal.aborted) {
        setReplays({ replay, before: throughputSeries(before, a.ticks), after: throughputSeries(after, a.ticks) });
      }
    })().catch((e: unknown) => {
      if (!ac.signal.aborted && !isAbort(e)) setReplayError(e instanceof Error ? e.message : String(e));
    });
    return () => ac.abort();
  }, [run, layout, a, rc]);

  const copy = stepCopy(a, state.step);
  const rows = useMemo(() => baselineRows(a, layout, p.scenario, state.reached4), [a, layout, p.scenario, state.reached4]);
  const reportText = useMemo(() => templateReport(a), [a]);

  const onCopy = () => {
    navigator.clipboard?.writeText(reportText).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <section className="card autopsy" aria-labelledby="autopsy-title">
      <header className="autopsy-head">
        <div>
          <p className="label mono">
            Step {state.step} of {STEP_COUNT}
          </p>
          <h2 id="autopsy-title" className="autopsy-title">
            {copy.title}
          </h2>
          <p className="section-note">{copy.caption}</p>
        </div>
        <div className="autopsy-nav">
          <button type="button" className="btn" disabled={state.step === 1} onClick={() => dispatch({ type: 'back' })}>
            Back
          </button>
          <button type="button" className="btn" onClick={() => p.onPlayFrom(focusTick(a, state.step))}>
            Play
          </button>
          <button
            type="button"
            className="btn"
            disabled={state.step === STEP_COUNT}
            onClick={() => dispatch({ type: 'next' })}
          >
            Next
          </button>
          <button type="button" className="btn" aria-pressed={report} onClick={() => setReport((r) => !r)}>
            Report
          </button>
        </div>
      </header>
      <ol className="autopsy-steps" aria-label="autopsy steps">
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <li key={i}>
            <button
              type="button"
              className="chip"
              aria-pressed={state.step === i + 1}
              aria-label={`step ${i + 1}`}
              onClick={() => dispatch({ type: 'goto', step: i + 1 })}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        Step {state.step} of {STEP_COUNT}: {copy.title}
      </p>

      {state.step === 1 && (
        <dl className="bignums">
          <div className="bignum">
            <dt className="label">Onset</dt>
            <dd>
              <span className="num">{a.jam.onsetTick}</span> <span className="unit">tick</span>
            </dd>
          </div>
          <div className="bignum">
            <dt className="label">Detected</dt>
            <dd>
              <span className="num">{a.jam.detectedTick}</span> <span className="unit">tick</span>
            </dd>
          </div>
          <div className="bignum">
            <dt className="label">Severity</dt>
            <dd>
              <span className="num">{Math.round(a.jam.severity * 100)}</span> <span className="unit">%</span>
            </dd>
          </div>
        </dl>
      )}

      {state.step === 2 && (
        <ul className="suspects" aria-label="suspects">
          {suspects(a).map((s, i) => (
            <li key={i} className="suspect">
              <span className="label">
                {s.label}
                {s.lead ? ' · leading' : ''}
              </span>
              <span className="qbar" aria-hidden="true">
                <span className="qbar-fill" style={{ width: `${(s.score ?? 0) * 100}%` }} />
              </span>
              <span className="mono value">{s.score === null ? 'not replayed' : s.score.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}

      {state.step === 3 &&
        (rc === null ? (
          <p className="muted">No replay to compare.</p>
        ) : replays?.replay && p.observed ? (
          <SideBySide layout={layout} observed={p.observed} replay={replays.replay} playhead={p.playhead} />
        ) : (
          <p className="muted">{replayError ?? 'Replaying'}</p>
        ))}

      {state.step === 4 && (
        <div className="autopsy-cols">
          <div>
            <p className="label">Evidence · confidence {rc ? rc.confidence : 'none'}</p>
            {rc ? (
              <ul className="assumptions">
                {rc.evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">No root cause was found.</p>
            )}
          </div>
          <Baselines rows={rows} />
        </div>
      )}

      {state.step === 5 && (
        <div className="autopsy-cols">
          <div>
            {replays ? (
              <FixCurves before={replays.before} after={replays.after} />
            ) : (
              <p className="muted">{replayError ?? 'Replaying'}</p>
            )}
            <p className="badge">
              {a.fix.passed ? 'verified in simulation' : 'not verified'} · recovered {(a.fix.recoveredFraction * 100).toFixed(0)}%
            </p>
            <p>{a.fix.fix ?? 'No fix proposed.'}</p>
            <p className="note">
              {a.fix.throughputBefore.toFixed(2)} → {a.fix.throughputAfter.toFixed(2)} deliveries / 100 ticks (no-fault{' '}
              {a.fix.throughputBaseline.toFixed(2)})
            </p>
            <button type="button" className="btn" aria-pressed={p.fixActive} disabled={rc === null} onClick={p.onToggleFix}>
              {p.fixActive ? 'Back to the observed run' : 'Replay with fix applied'}
            </button>
          </div>
          <Baselines rows={rows} />
        </div>
      )}

      {report && (
        <section className="autopsy-report" aria-label="template report">
          <div className="autopsy-report-head">
            <p className="label">Template report · built from the autopsy data</p>
            <button type="button" className="btn" onClick={onCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="autopsy-report-text">{reportText}</pre>
        </section>
      )}
    </section>
  );
}

function Baselines({ rows }: { rows: ReturnType<typeof baselineRows> }) {
  return (
    <table className="stations baselines">
      <caption className="label">Who gets the blame</caption>
      <thead>
        <tr>
          <th scope="col">Method</th>
          <th scope="col">Pick</th>
          <th scope="col">Against ground truth</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.method}>
            <td>{r.method}</td>
            <td>{r.pick}</td>
            <td>{r.correct === null ? 'n/a' : r.correct ? 'correct' : 'wrong'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FixCurves({ before, after }: { before: Int16Array; after: Int16Array }) {
  const top = Math.max(1, maxOf(before), maxOf(after));
  return (
    <figure className="fix-curves">
      <svg
        viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="throughput before and after the fix"
      >
        <polyline
          points={polylinePoints(before, before.length, CURVE_W, CURVE_H - 2, top)}
          fill="none"
          stroke="var(--fg-3)"
          strokeDasharray="4 3"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={polylinePoints(after, after.length, CURVE_W, CURVE_H - 2, top)}
          fill="none"
          stroke="var(--fg)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="note">dashed = observed run · solid = run without the diagnosed fault</figcaption>
    </figure>
  );
}

/** Observed run and replay at the shared playhead; robots in different cells are ringed. */
function SideBySide({ layout, observed, replay, playhead }: { layout: Layout; observed: Recording; replay: Recording; playhead: number }) {
  const leftBox = useRef<HTMLDivElement>(null);
  const rightBox = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLCanvasElement>(null);
  const right = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  const t = Math.max(0, Math.min(playhead, observed.frames - 1, replay.frames - 1));

  useEffect(() => {
    const boxes = [leftBox.current, rightBox.current];
    const ro = new ResizeObserver(() => setSize((s) => s + 1));
    for (const b of boxes) if (b) ro.observe(b);
    return () => ro.disconnect();
  }, []);

  const differ = useMemo(() => {
    const a = positionsAt(observed, t);
    const b = positionsAt(replay, t);
    const out: number[] = [];
    for (let r = 0; r < a.length; r++) if (a[r] !== b[r]) out.push(r);
    return out;
  }, [observed, replay, t]);

  useEffect(() => {
    const colors = readColors();
    const none = new Uint8Array(observed.robots);
    for (const [c, rec] of [
      [left.current, observed],
      [right.current, replay],
    ] as const) {
      const ctx = c?.getContext('2d');
      if (!c || !ctx) continue;
      const { cell } = fitCanvas(c, layout);
      drawFrame(ctx, layout, rec, t, { trails: false, congestion: false, waitCounts: null, stalled: none, blocked: null, reveal: null, colors });
      const pos = positionsAt(rec, t);
      ctx.strokeStyle = colors.robot;
      ctx.lineWidth = 1;
      for (const r of differ) {
        const x = (pos[r] % layout.width) + 0.5;
        const y = Math.floor(pos[r] / layout.width) + 0.5;
        ctx.beginPath();
        ctx.arc(x * cell, y * cell, cell * 0.62, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [layout, observed, replay, t, differ, size]);

  const aspect = { aspectRatio: `${layout.width} / ${layout.height}` };
  return (
    <div className="side-by-side">
      <figure>
        <div className="canvas-box" ref={leftBox} style={aspect}>
          <canvas ref={left} role="img" aria-label={`observed run at tick ${t}`} />
        </div>
        <figcaption className="note">Observed run · tick {t}</figcaption>
      </figure>
      <figure>
        <div className="canvas-box" ref={rightBox} style={aspect}>
          <canvas ref={right} role="img" aria-label={`replay with the leading hypothesis at tick ${t}`} />
        </div>
        <figcaption className="note">Replay with the leading hypothesis only</figcaption>
      </figure>
      <p className="note side-by-side-note">
        {differ.length} {differ.length === 1 ? 'robot differs' : 'robots differ'} at tick {t} · white ring = different cell
      </p>
    </div>
  );
}
