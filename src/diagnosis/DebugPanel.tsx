// Dev readout for the diagnosis engine (Spec 3, Requirement 9.3; design "Debug
// readout (task 11)", D14). Mounted only under `?debug=diagnose` by debugMount.tsx.
// Runs a curated scenario for 2000 ticks on the main thread, detects the jam,
// diagnoses it in a Web Worker with the Observed_Config only, then verifies the
// fix against the World_Config on the main thread. Styles are inline with the
// token custom properties plus the global .btn / .select / .label classes.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { detectJam } from '../sim/jam';
import { parseLayout } from '../sim/layout';
import type { LayoutManifest, LayoutMeta } from '../sim/layout';
import { SCENARIOS, scenarioConfig } from '../sim/scenarios';
import { runHeadless } from '../sim/sim';
import type { FaultEvent } from '../sim/types';
import { diagnoseInWorker } from './client';
import { verifyFix } from './fix';
import type { DiagnoseRequest, Diagnosis, FixResult, ObservedConfig, RankedFault } from './types';

const TICKS = 2000;

type Status =
  | { kind: 'idle' }
  | { kind: 'simulating' }
  | { kind: 'replaying'; done: number; total: number }
  | { kind: 'verifying'; diagnosis: Diagnosis }
  | { kind: 'done'; diagnosis: Diagnosis; fix: FixResult }
  | { kind: 'no-jam' }
  | { kind: 'error'; message: string };

/** `?scenario=<id>` when it names a curated scenario, else the first one. */
export function initialScenarioId(search: string): string {
  const id = new URLSearchParams(search).get('scenario');
  return SCENARIOS.some((s) => s.id === id) && id !== null ? id : SCENARIOS[0].id;
}

// Same BASE_URL paths as the app's loader in src/ui/App.tsx (not exported there).
async function loadManifest(): Promise<LayoutMeta[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}layouts/layouts.json`);
  if (!res.ok) throw new Error(`layouts.json: http ${res.status}`);
  return ((await res.json()) as LayoutManifest).layouts;
}

async function loadGridText(meta: LayoutMeta): Promise<string> {
  const res = await fetch(`${import.meta.env.BASE_URL}layouts/${meta.file}`);
  if (!res.ok) throw new Error(`${meta.file}: http ${res.status}`);
  return res.text();
}

function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError';
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Lets React paint the status before a synchronous run blocks the thread. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** `R3`, `S02`, or `cell 312`. */
function targetText(f: FaultEvent): string {
  switch (f.kind) {
    case 'robot-freeze':
    case 'slow-robot':
      return `R${f.robot}`;
    case 'station-slowdown':
      return `S${String(f.station + 1).padStart(2, '0')}`;
    case 'blocked-cell':
      return `cell ${f.cell}`;
  }
}

/** `01  R3 · robot-freeze · tick 550 · score 1.000 · gain 0.284 · impact 4.2 · high` */
function faultLine(r: RankedFault, i: number): string {
  return [
    `${String(i + 1).padStart(2, '0')}  ${targetText(r.fault)}`,
    r.fault.kind,
    `tick ${r.fault.tick}`,
    `score ${r.score.toFixed(3)}`,
    `gain ${r.gain.toFixed(3)}`,
    `impact ${r.impact.toFixed(1)}`,
    r.confidence,
  ].join(' · ');
}

function sameFault(a: FaultEvent, b: FaultEvent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- inline styles (token custom properties only) ----

const mono: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  lineHeight: '16px',
  fontVariantNumeric: 'tabular-nums',
};
const wrap: CSSProperties = {
  maxWidth: 1280,
  margin: '0 auto',
  padding: '0 24px 32px',
  background: 'var(--bg)',
  color: 'var(--ink)',
  borderTop: '1px solid var(--line)',
};
const section: CSSProperties = { padding: '16px 0', borderBottom: '1px solid var(--line)' };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 };
const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 };
const p: CSSProperties = { ...mono, margin: 0 };
const muted: CSSProperties = { ...p, color: 'var(--ink-2)' };
const evidenceList: CSSProperties = { ...list, gap: 0, paddingLeft: '4ch', marginTop: 4 };

export function DebugPanel() {
  const [scenarioId, setScenarioId] = useState(() => initialScenarioId(window.location.search));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  // Abort a running diagnosis on unmount.
  useEffect(() => cancel, [cancel]);

  const run = useCallback(async () => {
    cancel();
    const ac = new AbortController();
    controller.current = ac;
    const live = () => controller.current === ac && !ac.signal.aborted;
    try {
      const s = SCENARIOS.find((x) => x.id === scenarioId);
      if (!s) throw new Error(`no scenario ${scenarioId}`);
      setStatus({ kind: 'simulating' });
      const manifest = await loadManifest();
      const meta = manifest.find((m) => m.id === s.layoutId);
      if (!meta) throw new Error(`no layout ${s.layoutId}`);
      const gridText = await loadGridText(meta);
      if (!live()) return;
      const layout = parseLayout(meta, gridText);
      const world = scenarioConfig(s, layout);
      await nextFrame();
      if (!live()) return;
      const rec = runHeadless(layout, world, TICKS);
      const jam = detectJam(rec, layout, TICKS);
      if (jam === null) {
        setStatus({ kind: 'no-jam' });
        return;
      }
      // Only the Observed_Config crosses into the diagnosis (design D1).
      const config: ObservedConfig = { seed: world.seed, robots: world.robots, queueCap: world.queueCap };
      const req: DiagnoseRequest = { meta, gridText, config, rec, jam };
      setStatus({ kind: 'replaying', done: 0, total: 0 });
      const diagnosis = await diagnoseInWorker(req, {
        signal: ac.signal,
        onProgress: (done, total) => {
          if (live()) setStatus({ kind: 'replaying', done, total });
        },
      });
      if (!live()) return;
      setStatus({ kind: 'verifying', diagnosis });
      await nextFrame();
      if (!live()) return;
      const fix = verifyFix(layout, world, diagnosis);
      setStatus({ kind: 'done', diagnosis, fix });
    } catch (e) {
      if (isAbortError(e) || !live()) return; // superseded or cancelled
      setStatus({ kind: 'error', message: errorText(e) });
    } finally {
      if (controller.current === ac) controller.current = null;
    }
  }, [scenarioId, cancel]);

  const onScenario = (id: string) => {
    cancel();
    setStatus({ kind: 'idle' });
    setScenarioId(id);
  };

  const onCancel = () => {
    cancel();
    setStatus({ kind: 'idle' });
  };

  const busy = status.kind === 'simulating' || status.kind === 'replaying' || status.kind === 'verifying';
  const diagnosis = status.kind === 'done' || status.kind === 'verifying' ? status.diagnosis : null;
  const fix = status.kind === 'done' ? status.fix : null;

  return (
    <div style={wrap}>
      <div style={section}>
        <h2 className="label" style={{ marginBottom: 8 }}>
          00  DIAGNOSIS DEBUG
        </h2>
        <div style={row}>
          <label className="label" htmlFor="debug-scenario">
            scenario
          </label>
          <span className="select">
            <select id="debug-scenario" value={scenarioId} onChange={(e) => onScenario(e.target.value)}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </select>
          </span>
          <button type="button" className="btn" onClick={() => void run()}>
            run
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={!busy}>
            cancel
          </button>
        </div>
        <p style={{ ...muted, marginTop: 8 }} role="status" aria-live="polite">
          {status.kind === 'idle' && 'idle'}
          {status.kind === 'simulating' && `running ${TICKS} ticks`}
          {status.kind === 'replaying' &&
            (status.total === 0 ? 'starting worker' : `replaying ${status.done} of ${status.total} timelines`)}
          {status.kind === 'verifying' && `replayed ${status.diagnosis.replaysRun} timelines · verifying fix`}
          {status.kind === 'done' &&
            `replayed ${status.diagnosis.replaysRun} timelines · detected at tick ${status.diagnosis.evidence.detectedTick}`}
          {status.kind === 'no-jam' && 'no jam detected'}
          {status.kind === 'error' && <span style={{ color: 'var(--accent)' }}>error: {status.message}</span>}
        </p>
      </div>

      {diagnosis !== null && (
        <div style={section}>
          <h3 className="label" style={{ marginBottom: 8 }}>
            01  FAULTS
          </h3>
          {diagnosis.faults.length === 0 ? (
            <p style={p}>no fault selected</p>
          ) : (
            <ol style={list}>
              {diagnosis.faults.map((r, i) => {
                const root = diagnosis.rootCause !== null && sameFault(r.fault, diagnosis.rootCause.fault);
                return (
                  <li key={i}>
                    <p style={root ? { ...p, color: 'var(--accent)' } : p}>
                      {faultLine(r, i)}
                      {root && ' · root cause'}
                    </p>
                    <ul style={evidenceList}>
                      {r.evidence.map((line, k) => (
                        <li key={k} style={muted}>
                          {line}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {fix !== null && (
        <div style={section}>
          <h3 className="label" style={{ marginBottom: 8 }}>
            02  FIX
          </h3>
          <p style={p}>{fix.fix ?? 'no fix proposed'}</p>
          <p style={p}>
            sim-verified · recovered {fix.recoveredFraction.toFixed(2)} · {fix.passed ? 'pass' : 'fail'}
          </p>
          <p style={muted}>
            deliveries per 100 ticks · baseline {fix.throughputBaseline.toFixed(2)} · before{' '}
            {fix.throughputBefore.toFixed(2)} · after {fix.throughputAfter.toFixed(2)}
          </p>
          <p style={muted}>validated in simulation only</p>
        </div>
      )}
    </div>
  );
}
