// Playback app (design.md D10, Requirement 9). The Sim lives in a memo keyed by
// (layout, robots, seed). A rAF loop owns the playhead and redraws the canvas every
// frame it changes; React state for the header, panel, and scrubber is published at
// about 10 Hz so 16× playback does not re-render React on every tick.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { drawFrame, fitCanvas, readColors } from '../render/canvasRenderer';
import type { Layout, LayoutMeta } from '../sim/layout';
import { blockedAt, blockWindows } from '../sim/faults';
import { createWaitCounter, stalledAt, throughputSeries } from '../sim/metrics';
import { SCENARIOS, scenarioConfig } from '../sim/scenarios';
import { createSim } from '../sim/sim';
import type { Sim } from '../sim/sim';
import type { FaultEvent, Scenario } from '../sim/types';
import { detectJam } from '../sim/jam';
import { createTelemetryTracker } from '../sim/telemetry';
import { verifyRun } from '../sim/verify';
import type { Badge } from './badge';
import { CanvasLegend } from './CanvasLegend';
import { Controls } from './Controls';
import { SCENARIO_CLEARED_NOTE, verifierCopy } from './copy';
import { faultLegend, faultTicks, revealMarks } from './legend';
import { loadLayout, loadManifest } from './loaders';
import { Panel } from './Panel';
import { clampPlayhead, pad4, stepBack, stepForward, tickInterval } from './playback';
import type { Speed } from './playback';
import { Scrubber } from './Scrubber';
import type { TelemetryView } from './TelemetryPanel';

const DEFAULT_LAYOUT = 'fulfillment-block';
const DEFAULT_SEED = 42;
const PUBLISH_MS = 100; // React state updates at about 10 Hz
const VERIFY_MS = 250; // re-verify the growing recording at most 4 times a second
const TELEMETRY_MS = 250; // telemetry and jam detection at most 4 times a second (Requirement 9.4)
const MAX_STEPS_PER_FRAME = 32; // cap catch-up after a background tab
const SCENARIO_NOTE_MS = 3000; // how long "Scenario cleared…" stays visible

const EMPTY_SERIES = new Int16Array(0);
const NO_FAULTS: readonly FaultEvent[] = [];

function findScenario(id: string | null): Scenario | null {
  return id === null ? null : (SCENARIOS.find((s) => s.id === id) ?? null);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Keyboard shortcuts are ignored while focus is in a field that uses the keys itself. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

/** Mutable playback state shared by the rAF loop and the event handlers. */
interface Runtime {
  playhead: number;
  dirty: boolean;
  playing: boolean;
  speed: Speed;
  trails: boolean;
  congestion: boolean;
  reveal: boolean;
}

export interface AppProps {
  /** Wordmark: return to the landing view. */
  onHome?(): void;
  /** Header "How it works": open the drawer; focus returns to the opener on close. */
  onHowItWorks?(opener: HTMLElement): void;
}

export function App({ onHome, onHowItWorks }: AppProps = {}) {
  const [layouts, setLayouts] = useState<LayoutMeta[]>([]);
  const [layoutId, setLayoutId] = useState(DEFAULT_LAYOUT);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [robots, setRobots] = useState(0);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>(1);
  const [trails, setTrails] = useState(false);
  const [congestion, setCongestion] = useState(false);
  // Scenario (D19): null is healthy (faults []); faults are derived from the scenario.
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [scenarioNote, setScenarioNote] = useState<string | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Published at about 10 Hz by the loop, immediately by user actions.
  const [playhead, setPlayhead] = useState(0);
  const [frames, setFrames] = useState(1);
  const [badge, setBadge] = useState<Badge | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryView | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutCache = useRef(new Map<string, Layout>());
  const rt = useRef<Runtime>({
    playhead: 0,
    dirty: true,
    playing: true,
    speed: 1,
    trails: false,
    congestion: false,
    reveal: false,
  });
  const scenario = findScenario(scenarioId);
  // Read by the layout-load effect, which must not re-run when the scenario changes.
  // Set by the handlers together with scenarioId.
  const scenarioRef = useRef<Scenario | null>(null);

  // Manifest, once.
  useEffect(() => {
    let cancelled = false;
    loadManifest().then(
      (l) => {
        if (!cancelled) setLayouts(l);
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(errorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Selected layout; robots reset to the layout's recommended count in the same
  // render, or to the scenario's robots when a scenario for this layout is chosen (D19).
  useEffect(() => {
    const meta = layouts.find((m) => m.id === layoutId);
    if (!meta) return;
    let cancelled = false;
    const cached = layoutCache.current.get(meta.id);
    const p = cached ? Promise.resolve(cached) : loadLayout(meta);
    p.then(
      (l) => {
        if (cancelled) return;
        layoutCache.current.set(meta.id, l);
        setLoadError(null);
        setLayout(l);
        const s = scenarioRef.current;
        setRobots(s && s.layoutId === meta.id ? s.robots : meta.recommendedRobots);
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(errorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [layouts, layoutId]);

  // A new Sim whenever layout, robots, seed, or scenario change (D10, D19).
  // createSim is deterministic. While a chosen scenario's layout is still
  // loading, there is no Sim (its faults would not fit the old layout).
  const created = useMemo((): { sim: Sim | null; error: string | null } => {
    if (!layout || robots < 1) return { sim: null, error: null };
    if (scenario && scenario.layoutId !== layout.id) return { sim: null, error: null };
    try {
      const faults = scenario ? scenarioConfig(scenario, layout).faults : [];
      return { sim: createSim(layout, { seed, robots, queueCap: layout.queueCap, faults }), error: null };
    } catch (e) {
      return { sim: null, error: errorText(e) };
    }
  }, [layout, robots, seed, scenario]);
  const sim = created.sim;
  const faults: readonly FaultEvent[] = sim ? sim.config.faults : NO_FAULTS;
  // Incremental telemetry per Sim (Requirement 9.4). It reads the live recording.
  const tracker = useMemo(() => (sim ? createTelemetryTracker(sim.recording, sim.layout) : null), [sim]);

  // Keep the loop's view of toggles in sync and redraw on change.
  useEffect(() => {
    const r = rt.current;
    r.playing = playing;
    r.speed = speed;
    r.trails = trails;
    r.congestion = congestion;
    r.reveal = reveal;
    r.dirty = true;
  }, [playing, speed, trails, congestion, reveal]);

  const publish = useCallback(() => {
    if (!sim) return;
    setPlayhead(rt.current.playhead);
    setFrames(sim.recording.frames);
  }, [sim]);

  // Render loop for the current Sim.
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    const ctx = canvas?.getContext('2d');
    if (!sim || !tracker || !canvas || !box || !ctx) return;
    const { layout: lay } = sim;
    const r = rt.current;
    r.playhead = 0;
    r.dirty = true;
    const stalled = new Uint8Array(sim.config.robots);
    // 1 per robot with a reveal marker (filled only while revealed); the renderer
    // skips its stall ring and label so the culprit shows one accent marker.
    const revealSkip = new Uint8Array(sim.config.robots);
    const waits = createWaitCounter(lay);
    const colors = readColors();
    const simFaults = sim.config.faults;
    // Engaged blocks for the displayed frame (D7, D21). blockWindows clamps
    // permanent windows to rec.frames, so it is recomputed whenever the recording
    // has grown since the last draw; it stops scanning each fault at engagement,
    // so this is cheap. Only runs when the scenario has blocked-cell faults.
    const hasBlocks = simFaults.some((f) => f.kind === 'blocked-cell');
    const blocked = hasBlocks ? new Uint8Array(lay.kinds.length) : null;
    let windows: Int32Array = new Int32Array(0);
    let windowsFrames = -1;
    setBadge(null);
    setTelemetry(null);
    publish();

    // Telemetry up to the playhead, then detection on it. The tracker reuses its
    // arrays, so copy what React keeps. A backward seek recounts from 0.
    const S = sim.recording.stations;
    const updateTelemetry = (ph: number) => {
      const tel = tracker.advance(ph);
      const jam = detectJam(sim.recording, lay, ph, tel);
      const queues: number[] = new Array<number>(S);
      for (let s = 0; s < S; s++) queues[s] = tel.queueLen[ph * S + s];
      setTelemetry({ upTo: ph, throughput: tel.throughput.slice(), stalled20: tel.stalled20[ph], queues, jam });
    };

    const draw = () => {
      const rec = sim.recording;
      const ph = r.playhead;
      stalledAt(rec, ph, stalled);
      if (blocked) {
        if (rec.frames !== windowsFrames) {
          windows = blockWindows(simFaults, rec);
          windowsFrames = rec.frames;
        }
        blockedAt(simFaults, windows, ph, blocked);
      }
      const marks = r.reveal ? revealMarks(simFaults, ph) : null;
      if (marks) {
        revealSkip.fill(0);
        for (const m of marks) {
          if (m.target === 'robot' && m.index >= 0 && m.index < revealSkip.length) revealSkip[m.index] = 1;
        }
      }
      drawFrame(ctx, lay, rec, ph, {
        trails: r.trails,
        congestion: r.congestion,
        waitCounts: r.congestion ? waits.at(rec, ph) : null,
        stalled,
        blocked,
        reveal: marks,
        revealSkip: marks ? revealSkip : null,
        colors,
      });
    };

    const observer = new ResizeObserver(() => {
      fitCanvas(canvas, lay);
      r.dirty = true;
    });
    observer.observe(box);
    fitCanvas(canvas, lay);

    // Canvas text does not trigger web font loading; request Montserrat 500
    // (station digits and labels), and redraw once it is ready.
    let cancelled = false;
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts) {
      fonts
        .load(`500 11px 'Montserrat'`)
        .then(() => fonts.ready)
        .then(
          () => {
            if (!cancelled) r.dirty = true;
          },
          () => undefined,
        );
    }

    let last = performance.now();
    let acc = 0;
    let lastPublish = -Infinity;
    let lastVerify = -Infinity;
    let verifiedFrames = -1;
    let lastTelemetry = -Infinity;
    let telemetryAt = -1;
    let raf = 0;
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      if (r.playing) {
        acc += dt;
        const interval = tickInterval(r.speed);
        let steps = 0;
        while (acc >= interval && steps < MAX_STEPS_PER_FRAME) {
          r.playhead = stepForward(sim, r.playhead);
          acc -= interval;
          steps++;
        }
        if (steps === MAX_STEPS_PER_FRAME) acc = 0;
        if (steps > 0) r.dirty = true;
      } else {
        acc = 0;
      }
      if (r.dirty) {
        r.dirty = false;
        draw();
      }
      if (now - lastPublish >= PUBLISH_MS) {
        lastPublish = now;
        publish();
      }
      const rec = sim.recording;
      if (rec.frames !== verifiedFrames && now - lastVerify >= VERIFY_MS) {
        lastVerify = now;
        verifiedFrames = rec.frames;
        setBadge(verifierCopy(verifyRun(rec, lay, simFaults).length, sim.tick));
      }
      if (r.playhead !== telemetryAt && now - lastTelemetry >= TELEMETRY_MS) {
        lastTelemetry = now;
        telemetryAt = r.playhead;
        updateTelemetry(telemetryAt);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [sim, tracker, publish]);

  const seek = useCallback(
    (t: number) => {
      if (!sim) return;
      rt.current.playhead = clampPlayhead(sim, t);
      rt.current.dirty = true;
      publish();
    },
    [sim, publish],
  );

  const onStepForward = useCallback(() => {
    if (!sim) return;
    setPlaying(false);
    rt.current.playhead = stepForward(sim, rt.current.playhead);
    rt.current.dirty = true;
    publish();
  }, [sim, publish]);

  const onStepBack = useCallback(() => {
    if (!sim) return;
    setPlaying(false);
    rt.current.playhead = stepBack(rt.current.playhead);
    rt.current.dirty = true;
    publish();
  }, [sim, publish]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  // Keyboard: space toggles play, ←/→ step (Requirement 9.5).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) return;
      // The How it works dialog owns the keyboard while it has focus.
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return;
      if (e.key === ' ') {
        // A focused button already activates on space; let it.
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onStepBack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onStepForward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, onStepBack, onStepForward]);

  // Any manual change to layout, robots, or seed returns to healthy (D19); if a
  // scenario was active, a grey note says so for SCENARIO_NOTE_MS.
  const clearScenario = useCallback(() => {
    if (scenarioRef.current === null) return;
    scenarioRef.current = null;
    setScenarioId(null);
    setScenarioNote(SCENARIO_CLEARED_NOTE);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setScenarioNote(null), SCENARIO_NOTE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  const onLayout = useCallback(
    (id: string) => {
      if (id === layoutId) return;
      clearScenario();
      setLayoutId(id);
    },
    [layoutId, clearScenario],
  );

  const onRobots = useCallback(
    (n: number) => {
      clearScenario();
      setRobots(n);
    },
    [clearScenario],
  );

  const onSeed = useCallback(
    (n: number) => {
      if (n === seed) return;
      clearScenario();
      setSeed(n);
    },
    [seed, clearScenario],
  );

  // Choosing a scenario sets layout, robots, seed, and faults together (D19).
  // For another layout, the layout-load effect applies the scenario's robots.
  const onScenario = useCallback(
    (id: string | null) => {
      const s = findScenario(id);
      scenarioRef.current = s;
      window.clearTimeout(noteTimer.current);
      setScenarioNote(null);
      setScenarioId(s ? s.id : null);
      if (!s) return;
      setSeed(s.seed);
      if (s.layoutId === layoutId) setRobots(s.robots);
      else setLayoutId(s.layoutId);
    },
    [layoutId],
  );

  const rec = sim ? sim.recording : null;
  // State can lag a just-created Sim by one render; clamp into its recording.
  const shownFrames = rec ? Math.min(frames, rec.frames) : 1;
  const shownPlayhead = Math.min(playhead, shownFrames - 1);
  const series = useMemo(
    () => (sim ? throughputSeries(sim.recording, shownFrames - 1) : EMPTY_SERIES),
    [sim, shownFrames],
  );
  const meta = layouts.find((m) => m.id === (layout?.id ?? layoutId));
  const error = loadError ?? created.error;
  const shownFaultTicks = useMemo(() => (reveal ? faultTicks(faults) : null), [reveal, faults]);
  const legend = reveal && layout ? faultLegend(faults, scenario?.groundTruth ?? null, layout.width) : null;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1 className="header-title">
            <button
              type="button"
              className="wordmark"
              aria-label="Fleet Autopsy, back to start"
              onClick={() => onHome?.()}
            >
              Fleet Autopsy<span className="accent-dot">.</span>
            </button>
          </h1>
          <p className="scenario-name">{scenario?.name ?? 'Healthy fleet'}</p>
        </div>
        <div className="header-right">
          <p className="meta mono" aria-live="off">
            seed {pad4(seed)} · tick {pad4(shownPlayhead)}
          </p>
          <button type="button" className="btn btn--quiet" onClick={(e) => onHowItWorks?.(e.currentTarget)}>
            How it works
          </button>
        </div>
      </header>

      <Controls
        layouts={layouts}
        layoutId={layoutId}
        onLayout={onLayout}
        robots={Math.max(1, robots)}
        maxRobots={meta?.maxRobots ?? 1}
        recommendedRobots={meta?.recommendedRobots ?? 1}
        onRobots={onRobots}
        seed={seed}
        onSeed={onSeed}
        playing={playing}
        onTogglePlay={togglePlay}
        speed={speed}
        onSpeed={setSpeed}
        onStepBack={onStepBack}
        onStepForward={onStepForward}
        trails={trails}
        onTrails={setTrails}
        congestion={congestion}
        onCongestion={setCongestion}
        scenarios={SCENARIOS}
        scenarioId={scenarioId}
        onScenario={onScenario}
        scenarioNote={scenarioNote}
        reveal={reveal}
        onReveal={setReveal}
        disabled={!sim}
      />

      <main className="main">
        <div className="stage">
          <div
            className="canvas-box"
            ref={boxRef}
            style={layout ? { aspectRatio: `${layout.width} / ${layout.height}` } : undefined}
          >
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={layout ? `${layout.name} floor, ${robots} robots, tick ${shownPlayhead}` : 'warehouse floor'}
            />
          </div>
          <Scrubber
            rec={rec}
            frames={shownFrames}
            playhead={shownPlayhead}
            series={series}
            faultTicks={shownFaultTicks}
            onSeek={seek}
          />
          <CanvasLegend reveal={legend} />
        </div>
        <Panel
          layout={layout}
          rec={rec}
          playhead={shownPlayhead}
          frames={shownFrames}
          series={series}
          badge={badge}
          telemetry={telemetry}
          error={error}
        />
      </main>
    </div>
  );
}
